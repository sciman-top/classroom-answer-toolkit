#requires -Version 7
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePdf,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$ReferencePdf,

    [string]$PromptFile = "",
    [string]$SubjectPack = "junior-physics-answer",
    [string]$ConfigEnvFile = ".env",

    [ValidateSet("primary", "fallback", "all")]
    [string]$Provider = "all",

    [ValidateSet("auto", "sol-xhigh", "sol-medium", "sol-low", "terra-xhigh", "terra-high", "terra-medium", "luna-xhigh", "luna-high", "luna-medium")]
    [string]$BlindQualityProfile = "auto",

    [ValidateSet("auto", "sol-xhigh", "sol-medium", "sol-low", "terra-xhigh", "terra-high", "terra-medium", "luna-xhigh", "luna-high", "luna-medium")]
    [string]$SemanticQualityProfile = "auto",

    [ValidateSet("auto", "sol-xhigh", "sol-medium", "sol-low", "terra-xhigh", "terra-high", "terra-medium", "luna-xhigh", "luna-high", "luna-medium")]
    [string]$VisualQualityProfile = "auto",

    [ValidateSet("auto", "sol-xhigh", "sol-medium", "sol-low", "terra-xhigh", "terra-high", "terra-medium", "luna-xhigh", "luna-high", "luna-medium")]
    [string]$ReferenceQualityProfile = "auto",

    [ValidateSet("classroom", "compact")]
    [string]$Profile = "classroom",

    [ValidateSet("low", "high", "original")]
    [string]$VisualDetail = "original",

    [ValidateRange(1000, 100000)]
    [int]$MaxOutputTokens = 24000,

    [ValidateRange(1000, 1800000)]
    [int]$TimeoutMs = 600000,

    [ValidateRange(1.0, 4.0)]
    [double]$ReviewScale = 2.0,

    [ValidateRange(2.0, 4.0)]
    [double]$VisualAuditScale = 4.0,

    [string]$BlindFocusRegionsFile,

    [string]$VisualAuditFocusRegionsFile,

    # A previous failed run can supply a hash-bound blind candidate. The resumed
    # run must write to a different output directory so the failed audit anchor
    # stays immutable and the candidate can be traced to its original receipt.
    [string]$ResumeFromWorkflowReceipt,

    [switch]$SkipVisualAudit,

    [switch]$UseGatewayProxy,

    [switch]$KeepReview
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-WorkflowPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if ([System.IO.Path]::IsPathFullyQualified($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $PathValue))
}

function Assert-WorkflowOutputDoesNotOverwriteInput {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Inputs,
        [Parameter(Mandatory = $true)][hashtable]$Outputs
    )

    foreach ($inputName in $Inputs.Keys) {
        $inputPath = $Inputs[$inputName]
        if ([string]::IsNullOrWhiteSpace($inputPath)) {
            continue
        }

        foreach ($outputName in $Outputs.Keys) {
            $outputPath = $Outputs[$outputName]
            if ([string]::Equals(
                    [IO.Path]::GetFullPath($inputPath),
                    [IO.Path]::GetFullPath($outputPath),
                    [StringComparison]::OrdinalIgnoreCase)) {
                throw "Workflow output $outputName collides with input $inputName`: $outputPath"
            }
        }
    }
}

function Get-WorkflowFileReceipt {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue) -or -not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        return $null
    }

    $item = Get-Item -LiteralPath $PathValue
    return [ordered]@{
        path = $item.FullName
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Assert-WorkflowInputUnchanged {
    param(
        [Parameter(Mandatory = $true)][string]$InputName,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$ExpectedReceipt
    )

    $currentReceipt = Get-WorkflowFileReceipt -PathValue $ExpectedReceipt.path
    if ($null -eq $currentReceipt -or
        $currentReceipt.bytes -ne $ExpectedReceipt.bytes -or
        $currentReceipt.sha256 -ne $ExpectedReceipt.sha256) {
        $actualSha = if ($null -eq $currentReceipt) { "<missing>" } else { $currentReceipt.sha256 }
        throw "Workflow input drift detected for $InputName`: expected SHA-256 $($ExpectedReceipt.sha256), actual $actualSha. Start a new run with frozen inputs."
    }
}

function Assert-WorkflowInputsUnchanged {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$InputReceipts)

    foreach ($inputName in $InputReceipts.Keys) {
        $receipt = $InputReceipts[$inputName]
        if ($null -ne $receipt) {
            Assert-WorkflowInputUnchanged -InputName $inputName -ExpectedReceipt $receipt
        }
    }
}

function Test-WorkflowFileReceiptMatches {
    param(
        [AllowNull()]$ExpectedReceipt,
        [AllowNull()]$ActualReceipt
    )

    if ($null -eq $ExpectedReceipt -or $null -eq $ActualReceipt) {
        return $null -eq $ExpectedReceipt -and $null -eq $ActualReceipt
    }

    return ($ExpectedReceipt.path -eq $ActualReceipt.path -and
        $ExpectedReceipt.bytes -eq $ActualReceipt.bytes -and
        $ExpectedReceipt.sha256 -eq $ActualReceipt.sha256)
}

function Assert-ResumeBlindGeneration {
    param(
        [Parameter(Mandatory = $true)][string]$ReceiptPath,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$CurrentInputs
    )

    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) {
        throw "Resume workflow receipt not found: $ReceiptPath"
    }

    try {
        $resumeReceipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json -AsHashtable
    }
    catch {
        throw "Resume workflow receipt is not valid JSON: $ReceiptPath. $($_.Exception.Message)"
    }

    if ($resumeReceipt.kind -ne "live-answer-workflow-run" -or $resumeReceipt.status -ne "failed") {
        throw "Resume workflow receipt must be a failed live-answer-workflow-run: $ReceiptPath"
    }

    $inputNameMap = [ordered]@{
        SourcePdf = "sourcePdf"
        ReferencePdf = "referencePdf"
        PromptFile = "prompt"
        BlindFocusRegionsFile = "blindFocusRegions"
        VisualAuditFocusRegionsFile = "visualAuditFocusRegions"
    }
    foreach ($inputName in $inputNameMap.Keys) {
        $priorReceipt = $resumeReceipt.inputs[$inputNameMap[$inputName]]
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $priorReceipt -ActualReceipt $CurrentInputs[$inputName])) {
            throw "Resume workflow input does not match current $inputName`: $ReceiptPath"
        }
    }

    $blindPhase = $resumeReceipt.phases.blindGeneration
    if ($null -eq $blindPhase -or $blindPhase.status -ne "completed") {
        throw "Resume workflow receipt has no completed blindGeneration phase: $ReceiptPath"
    }
    foreach ($kind in @("summary", "artifact")) {
        $boundReceipt = $blindPhase[$kind]
        if ($null -eq $boundReceipt -or -not (Test-Path -LiteralPath $boundReceipt.path -PathType Leaf)) {
            throw "Resume blindGeneration $kind is missing: $ReceiptPath"
        }
        $actualReceipt = Get-WorkflowFileReceipt -PathValue $boundReceipt.path
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $boundReceipt -ActualReceipt $actualReceipt)) {
            throw "Resume blindGeneration $kind hash mismatch: $($boundReceipt.path)"
        }
    }

    return [ordered]@{
        workflowReceipt = Get-WorkflowFileReceipt -PathValue $ReceiptPath
        phases = $resumeReceipt.phases
        blindGeneration = [ordered]@{
            summary = $blindPhase.summary
            artifact = $blindPhase.artifact
        }
    }
}

function Copy-ResumePhaseArtifacts {
    param(
        [Parameter(Mandatory = $true)]$ResumeProvenance,
        [Parameter(Mandatory = $true)][string]$PhaseName,
        [string]$DestinationSummaryPath,
        [Parameter(Mandatory = $true)][string]$DestinationArtifactPath
    )

    $phase = $ResumeProvenance.phases[$PhaseName]
    if ($null -eq $phase -or $phase.status -ne "completed") {
        return $false
    }

    foreach ($kind in @("artifact", $(if ($DestinationSummaryPath) { "summary" }))) {
        $boundReceipt = $phase[$kind]
        if ($null -eq $boundReceipt -or -not (Test-Path -LiteralPath $boundReceipt.path -PathType Leaf)) {
            throw "Resume $PhaseName $kind is missing: $($ResumeProvenance.workflowReceipt.path)"
        }
        $actualReceipt = Get-WorkflowFileReceipt -PathValue $boundReceipt.path
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $boundReceipt -ActualReceipt $actualReceipt)) {
            throw "Resume $PhaseName $kind hash mismatch: $($boundReceipt.path)"
        }
    }

    Copy-WorkflowFileAtomic -SourcePath $phase.artifact.path -DestinationPath $DestinationArtifactPath
    if ($DestinationSummaryPath) {
        Copy-WorkflowFileAtomic -SourcePath $phase.summary.path -DestinationPath $DestinationSummaryPath
    }
    $script:reusedResumePhaseNames += $PhaseName
    return $true
}

function Write-JsonFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)]$Value
    )

    $resolvedPath = [IO.Path]::GetFullPath($PathValue)
    $directory = [IO.Path]::GetDirectoryName($resolvedPath)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($resolvedPath), [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporaryPath, $resolvedPath, $true)
    }
    finally {
        [IO.File]::Delete($temporaryPath)
    }
}

function Copy-WorkflowFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    $resolvedDestination = [IO.Path]::GetFullPath($DestinationPath)
    $directory = [IO.Path]::GetDirectoryName($resolvedDestination)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($resolvedDestination), [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::Copy($SourcePath, $temporaryPath, $true)
        [IO.File]::Move($temporaryPath, $resolvedDestination, $true)
    }
    finally {
        [IO.File]::Delete($temporaryPath)
    }
}

function Get-GatewayHostnames {
    param([Parameter(Mandatory = $true)][string]$EnvFilePath)

    $hostnames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in Get-Content -LiteralPath $EnvFilePath) {
        if ($line -notmatch '^\s*CLASSROOM_TOOLKIT_AI_(?:PRIMARY|FALLBACK_\d+)_BASE_URL\s*=\s*(?<value>.+?)\s*$') {
            continue
        }
        $value = $Matches.value.Trim().Trim('"').Trim("'")
        $uri = $null
        if ([Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri)) {
            [void]$hostnames.Add($uri.Host)
        }
    }
    return @($hostnames)
}

$sourcePath = Resolve-WorkflowPath $SourcePdf
$outputRoot = Resolve-WorkflowPath $OutputDirectory
if ([string]::IsNullOrWhiteSpace($PromptFile)) {
    $defaultManifestPath = Join-Path $repoRoot "prompts/$SubjectPack/manifest.json"
    if (-not (Test-Path -LiteralPath $defaultManifestPath -PathType Leaf)) {
        throw "Subject pack manifest not found: $defaultManifestPath"
    }
    $defaultManifest = Get-Content -LiteralPath $defaultManifestPath -Raw | ConvertFrom-Json
    $defaultHumanSpec = $defaultManifest.sourceOfTruth.humanSpec
    if ([string]::IsNullOrWhiteSpace($defaultHumanSpec)) {
        throw "Default subject pack manifest lacks sourceOfTruth.humanSpec: $defaultManifestPath"
    }
    $promptPath = Resolve-WorkflowPath (Join-Path "prompts/$SubjectPack" $defaultHumanSpec)
}
else {
    $promptPath = Resolve-WorkflowPath $PromptFile
}
$envFilePath = Resolve-WorkflowPath $ConfigEnvFile
$blindFocusRegionsPath = if ([string]::IsNullOrWhiteSpace($BlindFocusRegionsFile)) {
    $null
}
else {
    Resolve-WorkflowPath $BlindFocusRegionsFile
}
$visualAuditFocusRegionsPath = if ([string]::IsNullOrWhiteSpace($VisualAuditFocusRegionsFile)) {
    $null
}
else {
    Resolve-WorkflowPath $VisualAuditFocusRegionsFile
}

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Source PDF not found: $sourcePath"
}

if (-not (Test-Path -LiteralPath $promptPath -PathType Leaf)) {
    throw "Prompt file not found: $promptPath"
}

if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
    throw "Gateway env file not found: $envFilePath"
}

if ($blindFocusRegionsPath -and -not (Test-Path -LiteralPath $blindFocusRegionsPath -PathType Leaf)) {
    throw "Blind focus regions file not found: $blindFocusRegionsPath"
}

if ($visualAuditFocusRegionsPath -and -not (Test-Path -LiteralPath $visualAuditFocusRegionsPath -PathType Leaf)) {
    throw "Visual audit focus regions file not found: $visualAuditFocusRegionsPath"
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
$answerMarkdownPath = Join-Path $outputRoot "${baseName}参考答案.md"
$blindMarkdownPath = Join-Path $outputRoot "${baseName}盲答候选.md"
$visualAuditMarkdownPath = Join-Path $outputRoot "${baseName}视觉审计候选.md"
$visualAuditFindingsPath = Join-Path $outputRoot "${baseName}视觉审计发现.md"
$semanticFindingsPath = Join-Path $outputRoot "${baseName}语义复核发现.md"
$semanticReviewMarkdownPath = Join-Path $outputRoot "${baseName}语义复核候选.md"
$answerPdfPath = Join-Path $outputRoot "${baseName}参考答案.pdf"
$comparisonReportPath = Join-Path $outputRoot "${baseName}答案自动复核文本差异报告.md"
$visualAuditReportPath = Join-Path $outputRoot "${baseName}盲答与视觉审计差异报告.md"
$semanticReviewReportPath = Join-Path $outputRoot "${baseName}盲答与语义复核差异报告.md"
$blindSummaryPath = Join-Path $outputRoot "${baseName}.blind-generation.summary.json"
$semanticFindingsSummaryPath = Join-Path $outputRoot "${baseName}.semantic-findings.summary.json"
$semanticMergeSummaryPath = Join-Path $outputRoot "${baseName}.semantic-merge.summary.json"
$visualFindingsSummaryPath = Join-Path $outputRoot "${baseName}.visual-findings.summary.json"
$visualMergeSummaryPath = Join-Path $outputRoot "${baseName}.visual-merge.summary.json"
$referenceReviewSummaryPath = Join-Path $outputRoot "${baseName}.reference-review.summary.json"
$workflowReceiptPath = Join-Path $outputRoot "${baseName}.workflow-run.json"
$deliveryManifestPath = Join-Path $outputRoot "${baseName}参考答案.delivery-manifest.json"
$deliverySnapshotPath = Join-Path $outputRoot "${baseName}参考答案.snapshot.json"
$deliveryReviewDirectory = Join-Path $outputRoot "${baseName}参考答案.review"
$workRoot = Join-Path $env:TEMP ("classroom-answer-toolkit\live-answer-workflow\" + [Guid]::NewGuid().ToString("N"))
$pageDirectory = Join-Path $workRoot "pages"
$visualAuditPageDirectory = Join-Path $workRoot "visual-audit-pages"
$referencePageDirectory = Join-Path $workRoot "reference-pages"
$sourceTextPath = Join-Path $workRoot "source-exam-text.txt"
$referenceTextPath = Join-Path $workRoot "reference-answer-text.txt"
$workflowSucceeded = $false
$previousCloudEgress = $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
$previousNodeOptions = $env:NODE_OPTIONS
$previousNoProxy = $env:NO_PROXY
$referencePath = if ([string]::IsNullOrWhiteSpace($ReferencePdf)) { $null } else { Resolve-WorkflowPath $ReferencePdf }
$resumeWorkflowReceiptPath = if ([string]::IsNullOrWhiteSpace($ResumeFromWorkflowReceipt)) { $null } else { Resolve-WorkflowPath $ResumeFromWorkflowReceipt }
$workflowRunId = [Guid]::NewGuid().ToString("N")
$workflowStartedAt = [DateTimeOffset]::UtcNow
$currentPhase = $null
$reusedResumePhaseNames = @()

if ($referencePath -and -not (Test-Path -LiteralPath $referencePath -PathType Leaf)) {
    throw "Reference PDF not found: $referencePath"
}

$workflowInputReceipts = [ordered]@{
    SourcePdf = Get-WorkflowFileReceipt -PathValue $sourcePath
    ReferencePdf = Get-WorkflowFileReceipt -PathValue $referencePath
    PromptFile = Get-WorkflowFileReceipt -PathValue $promptPath
    BlindFocusRegionsFile = Get-WorkflowFileReceipt -PathValue $blindFocusRegionsPath
    VisualAuditFocusRegionsFile = Get-WorkflowFileReceipt -PathValue $visualAuditFocusRegionsPath
}

Assert-WorkflowOutputDoesNotOverwriteInput -Inputs @{
    SourcePdf = $sourcePath
    ReferencePdf = $referencePath
    PromptFile = $promptPath
    ConfigEnvFile = $envFilePath
    BlindFocusRegionsFile = $blindFocusRegionsPath
    VisualAuditFocusRegionsFile = $visualAuditFocusRegionsPath
    ResumeWorkflowReceipt = $resumeWorkflowReceiptPath
} -Outputs @{
    AnswerMarkdown = $answerMarkdownPath
    BlindMarkdown = $blindMarkdownPath
    VisualAuditMarkdown = $visualAuditMarkdownPath
    VisualAuditFindings = $visualAuditFindingsPath
    SemanticFindings = $semanticFindingsPath
    SemanticReviewMarkdown = $semanticReviewMarkdownPath
    AnswerPdf = $answerPdfPath
    ComparisonReport = $comparisonReportPath
    VisualAuditReport = $visualAuditReportPath
    SemanticReviewReport = $semanticReviewReportPath
    BlindSummary = $blindSummaryPath
    SemanticFindingsSummary = $semanticFindingsSummaryPath
    SemanticMergeSummary = $semanticMergeSummaryPath
    VisualFindingsSummary = $visualFindingsSummaryPath
    VisualMergeSummary = $visualMergeSummaryPath
    ReferenceReviewSummary = $referenceReviewSummaryPath
    WorkflowReceipt = $workflowReceiptPath
    DeliveryManifest = $deliveryManifestPath
    DeliverySnapshot = $deliverySnapshotPath
    DeliveryReview = $deliveryReviewDirectory
}

$resumeProvenance = if ($resumeWorkflowReceiptPath) {
    Assert-ResumeBlindGeneration -ReceiptPath $resumeWorkflowReceiptPath -CurrentInputs $workflowInputReceipts
}
else {
    $null
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$generationOutputPath = $blindMarkdownPath
$phaseStates = [ordered]@{
    blindGeneration = [ordered]@{ status = "pending"; summaryPath = $blindSummaryPath; artifactPath = $generationOutputPath }
    semanticFindings = [ordered]@{ status = "pending"; summaryPath = $semanticFindingsSummaryPath; artifactPath = $semanticFindingsPath }
    semanticMerge = [ordered]@{ status = "pending"; summaryPath = $semanticMergeSummaryPath; artifactPath = $semanticReviewMarkdownPath }
    visualFindings = [ordered]@{ status = $(if ($SkipVisualAudit) { "skipped" } else { "pending" }); summaryPath = $visualFindingsSummaryPath; artifactPath = $visualAuditFindingsPath }
    visualMerge = [ordered]@{ status = $(if ($SkipVisualAudit) { "skipped" } else { "pending" }); summaryPath = $visualMergeSummaryPath; artifactPath = $visualAuditMarkdownPath }
    referenceReview = [ordered]@{ status = $(if ($referencePath) { "pending" } else { "skipped" }); summaryPath = $referenceReviewSummaryPath; artifactPath = $answerMarkdownPath }
    delivery = [ordered]@{ status = "pending"; summaryPath = $null; artifactPath = $answerPdfPath }
}

foreach ($summaryPath in @($blindSummaryPath, $semanticFindingsSummaryPath, $semanticMergeSummaryPath, $visualFindingsSummaryPath, $visualMergeSummaryPath, $referenceReviewSummaryPath, $workflowReceiptPath)) {
    Remove-Item -LiteralPath $summaryPath -Force -ErrorAction SilentlyContinue
}

# Previous-run finals must never survive into a failed rerun as a seemingly complete
# delivery set; this includes the delivery-owned review directory. Quarantine them
# under .stale-runs/<runId> before this run writes anything.
$staleRunDirectory = Join-Path $outputRoot (".stale-runs/" + $workflowRunId)
foreach ($finalPath in @($answerMarkdownPath, $answerPdfPath, $deliveryManifestPath, $deliverySnapshotPath, $deliveryReviewDirectory)) {
    if (Test-Path -LiteralPath $finalPath) {
        New-Item -ItemType Directory -Force -Path $staleRunDirectory | Out-Null
        Move-Item -LiteralPath $finalPath -Destination $staleRunDirectory -Force
    }
}

function Write-WorkflowReceipt {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("succeeded", "failed")][string]$Status,
        [string]$ErrorMessage
    )

    $phaseReceipts = [ordered]@{}
    foreach ($phaseName in $phaseStates.Keys) {
        $state = $phaseStates[$phaseName]
        $phaseReceipt = [ordered]@{
            status = $state.status
            summaryPath = $state.summaryPath
            artifactPath = $state.artifactPath
            summary = $null
            artifact = $null
        }
        if ($state.status -eq "completed") {
            $phaseReceipt.summary = Get-WorkflowFileReceipt -PathValue $state.summaryPath
            $phaseReceipt.artifact = Get-WorkflowFileReceipt -PathValue $state.artifactPath
        }
        if ($state.Contains("error")) {
            $phaseReceipt.error = $state.error
        }
        $phaseReceipts[$phaseName] = $phaseReceipt
    }

    $artifacts = @()
    if ($Status -eq "succeeded") {
        foreach ($artifactPath in @(
                $answerMarkdownPath,
                $answerPdfPath,
                $deliveryManifestPath,
                $deliverySnapshotPath,
                $semanticFindingsPath,
                $semanticReviewMarkdownPath,
                $semanticReviewReportPath,
                $(if (-not $SkipVisualAudit) { $visualAuditFindingsPath; $visualAuditMarkdownPath; $visualAuditReportPath }),
                $(if ($referencePath) { $comparisonReportPath })
            )) {
            $artifactReceipt = Get-WorkflowFileReceipt -PathValue $artifactPath
            if ($null -ne $artifactReceipt) {
                $artifacts += $artifactReceipt
            }
        }
    }

    $receipt = [ordered]@{
        schemaVersion = "1.0"
        kind = "live-answer-workflow-run"
        runId = $workflowRunId
        status = $Status
        startedAt = $workflowStartedAt.ToString("O")
        finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
        inputs = [ordered]@{
            sourcePdf = $workflowInputReceipts.SourcePdf
            referencePdf = $workflowInputReceipts.ReferencePdf
            prompt = $workflowInputReceipts.PromptFile
            blindFocusRegions = $workflowInputReceipts.BlindFocusRegionsFile
            visualAuditFocusRegions = $workflowInputReceipts.VisualAuditFocusRegionsFile
        }
        options = [ordered]@{
            provider = $Provider
            subjectPack = $SubjectPack
            profile = $Profile
            blindQualityProfile = $BlindQualityProfile
            semanticQualityProfile = $SemanticQualityProfile
            visualQualityProfile = $VisualQualityProfile
            referenceQualityProfile = $ReferenceQualityProfile
            visualDetail = $VisualDetail
            maxOutputTokens = $MaxOutputTokens
            timeoutMs = $TimeoutMs
            reviewScale = $ReviewScale
            visualAuditScale = $VisualAuditScale
            blindFocusRegionsFile = $blindFocusRegionsPath
            visualAuditFocusRegionsFile = $visualAuditFocusRegionsPath
            skipVisualAudit = [bool]$SkipVisualAudit
            keepReview = [bool]$KeepReview
            useGatewayProxy = [bool]$UseGatewayProxy
            configEnvFile = $envFilePath
        }
        phases = $phaseReceipts
        artifacts = $artifacts
        resume = $(if ($resumeProvenance) {
                [ordered]@{
                    workflowReceipt = $resumeProvenance.workflowReceipt
                    blindGeneration = $resumeProvenance.blindGeneration
                    reusedPhases = @($reusedResumePhaseNames)
                }
            }
            else {
                $null
            })
        diagnostics = [ordered]@{
            retainedWorkRoot = $(if ($Status -eq "failed") { $workRoot } else { $null })
        }
        error = $(if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { $ErrorMessage })
    }

    Write-JsonFileAtomic -PathValue $workflowReceiptPath -Value $receipt

    # The receipt is the run's audit anchor: reject a structurally invalid
    # receipt instead of leaving an unvalidatable file behind.
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/rule-compiler/validate-json.mjs") -Arguments @(
        "--schema", (Join-Path $repoRoot "prompts/shared/schemas/live-answer-workflow-run.schema.json"),
        "--value", $workflowReceiptPath
    )
}

if ($UseGatewayProxy) {
    $configuredProxy = @($env:HTTPS_PROXY, $env:HTTP_PROXY, $env:ALL_PROXY) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1
    if (-not $configuredProxy) {
        throw "-UseGatewayProxy requires HTTPS_PROXY, HTTP_PROXY, or ALL_PROXY."
    }

    $nodeHelp = (& node --help 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $nodeHelp -notmatch '--use-env-proxy') {
        throw "The active Node.js runtime does not support --use-env-proxy."
    }

    if ($env:NODE_OPTIONS -notmatch '(?:^|\s)--use-env-proxy(?:\s|$)') {
        $env:NODE_OPTIONS = (@($env:NODE_OPTIONS, "--use-env-proxy") |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join " "
    }

    $gatewayHostnames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($hostname in Get-GatewayHostnames -EnvFilePath $envFilePath) {
        [void]$gatewayHostnames.Add($hostname)
    }
    $env:NO_PROXY = (($env:NO_PROXY -split ',') |
        ForEach-Object { $_.Trim() } |
        Where-Object {
            $_ -and -not $gatewayHostnames.Contains($_.TrimStart('.'))
        }) -join ','
    Write-Host "[live-answer-workflow] environment proxy enabled for configured AI gateway hosts"
}

function Invoke-NodeTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $toolOutput = @(& node $ScriptPath @Arguments 2>&1)
    $toolExitCode = $LASTEXITCODE
    $toolOutput | ForEach-Object { Write-Output $_ }
    if ($toolExitCode -ne 0) {
        $diagnostics = (($toolOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
        if ([string]::IsNullOrWhiteSpace($diagnostics)) {
            $diagnostics = "<node tool produced no diagnostic output>"
        }
        if ($diagnostics.Length -gt 12000) {
            $diagnostics = "[node tool output truncated; showing the final 12000 characters]`n" +
                $diagnostics.Substring($diagnostics.Length - 12000)
        }
        throw "Node tool failed with exit code $toolExitCode`: $ScriptPath`n$diagnostics"
    }
}

# Common answer-request arguments for the six AI stages. Stage deltas only:
# --visual-detail applies to image-inspection stages, --images-dir/-source-text
# to whole-paper stages, and reference inputs only to reference review.
function New-AnswerRequestArguments {
    param(
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][string]$SummaryPath,
        [Parameter(Mandatory = $true)][string]$QualityProfile,
        [string]$ImagesDir,
        [string]$CandidateFile,
        [string]$SemanticFindingsFile,
        [string]$AuditImagesDir,
        [string]$AuditFindingsFile,
        [string]$ReferenceImagesDir,
        [string]$ReferenceTextFile,
        [switch]$SemanticFindingsOnly,
        [switch]$AuditFindingsOnly,
        [switch]$IncludeVisualDetail,
        [switch]$IncludeSourceText
    )

    $arguments = @(
        "--config-env-file", $envFilePath,
        "--prompt-file", $promptPath,
        "--output", $OutputPath,
        "--summary-out", $SummaryPath,
        "--provider", $Provider,
        "--quality-profile", $QualityProfile,
        "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--allow-cloud-egress"
    )
    if ($IncludeVisualDetail) {
        $arguments += @("--visual-detail", $VisualDetail)
    }
    if ($ImagesDir) {
        $arguments += @("--images-dir", $ImagesDir)
    }
    if ($CandidateFile) {
        $arguments += @("--candidate-file", $CandidateFile)
    }
    if ($SemanticFindingsOnly) {
        $arguments += "--semantic-findings-only"
    }
    if ($SemanticFindingsFile) {
        $arguments += @("--semantic-findings-file", $SemanticFindingsFile)
    }
    if ($AuditImagesDir) {
        $arguments += @("--audit-images-dir", $AuditImagesDir)
    }
    if ($AuditFindingsOnly) {
        $arguments += "--audit-findings-only"
    }
    if ($AuditFindingsFile) {
        $arguments += @("--audit-findings-file", $AuditFindingsFile)
    }
    if ($ReferenceImagesDir) {
        $arguments += @("--reference-images-dir", $ReferenceImagesDir)
    }
    if ($IncludeSourceText -and (Test-Path -LiteralPath $sourceTextPath -PathType Leaf)) {
        $arguments += @("--source-text-file", $sourceTextPath)
    }
    elseif ($IncludeSourceText) {
        # A missing text layer silently degrades scanned-PDF runs to pure image
        # input; the operator must see the downgrade instead of inferring it later.
        Write-Host "[run-live] Source text layer not found; continuing without --source-text-file: $sourceTextPath"
    }
    if ($ReferenceTextFile -and (Test-Path -LiteralPath $ReferenceTextFile -PathType Leaf)) {
        $arguments += @("--reference-text-file", $ReferenceTextFile)
    }
    return $arguments
}

try {
    # Resume runs still execute non-reused AI phases (semantic/visual findings),
    # so the egress override must cover every entry path, not just fresh
    # blindGeneration; otherwise -ResumeFromWorkflowReceipt fails its first live
    # request while the same .env works for a fresh run.
    $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    New-Item -ItemType Directory -Force -Path $pageDirectory | Out-Null

    Write-Host "[live-answer-workflow] render source PDF pages"
    $sourceRenderArguments = @(
        $sourcePath,
        "--out", $pageDirectory,
        "--pages", "all",
        "--scale", $ReviewScale.ToString([Globalization.CultureInfo]::InvariantCulture)
    )
    if ($blindFocusRegionsPath) {
        $sourceRenderArguments += @("--focus-regions-file", $blindFocusRegionsPath)
    }
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/review-source-pdf.mjs") -Arguments $sourceRenderArguments

    $pageImages = @(Get-ChildItem -LiteralPath $pageDirectory -File |
        Where-Object { $_.Name -match '\.page-\d+\.(png|jpg|jpeg|webp)$' } |
        Sort-Object Name)
    if ($pageImages.Count -eq 0) {
        throw "Source PDF rendering produced no page images: $pageDirectory"
    }
    $sourceTextLayers = @(Get-ChildItem -LiteralPath $pageDirectory -Filter "*.text-layer.txt" -File | Sort-Object Name)
    if ($sourceTextLayers.Count -gt 0) {
        $sourceText = ($sourceTextLayers | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n`n--- source page ---`n`n"
        Set-Content -LiteralPath $sourceTextPath -Value $sourceText -Encoding utf8 -NoNewline
    }

    if ($resumeProvenance) {
        Write-Host "[live-answer-workflow] resume hash-bound blind candidate without repeating generation"
        $currentPhase = "blindGeneration"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        [void](Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $blindSummaryPath -DestinationArtifactPath $generationOutputPath)
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
    }
    else {
        Write-Host "[live-answer-workflow] generate answer Markdown from $($pageImages.Count) page(s)"
        $currentPhase = "blindGeneration"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        $blindArguments = New-AnswerRequestArguments `
            -OutputPath $generationOutputPath `
            -SummaryPath $blindSummaryPath `
            -QualityProfile $BlindQualityProfile `
            -ImagesDir $pageDirectory `
            -IncludeVisualDetail `
            -IncludeSourceText
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $blindArguments
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
    }

    $currentPhase = "semanticFindings"
    $phaseStates[$currentPhase].status = "in_progress"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    if ($resumeProvenance -and (Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $semanticFindingsSummaryPath -DestinationArtifactPath $semanticFindingsPath)) {
        Write-Host "[live-answer-workflow] resume hash-bound semantic findings without repeating review"
    }
    else {
        Write-Host "[live-answer-workflow] independently re-solve semantic questions without the reference answer"
        $semanticFindingsArguments = New-AnswerRequestArguments `
            -OutputPath $semanticFindingsPath `
            -SummaryPath $semanticFindingsSummaryPath `
            -QualityProfile $SemanticQualityProfile `
            -ImagesDir $pageDirectory `
            -CandidateFile $blindMarkdownPath `
            -SemanticFindingsOnly `
            -IncludeVisualDetail `
            -IncludeSourceText
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $semanticFindingsArguments
    }
    $phaseStates[$currentPhase].status = "completed"
    $currentPhase = $null

    $currentPhase = "semanticMerge"
    $phaseStates[$currentPhase].status = "in_progress"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    if ($resumeProvenance -and (Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $semanticMergeSummaryPath -DestinationArtifactPath $semanticReviewMarkdownPath)) {
        Write-Host "[live-answer-workflow] resume hash-bound semantic merge without repeating review"
    }
    else {
        Write-Host "[live-answer-workflow] merge only independently confirmed semantic findings"
        $semanticMergeArguments = New-AnswerRequestArguments `
            -OutputPath $semanticReviewMarkdownPath `
            -SummaryPath $semanticMergeSummaryPath `
            -QualityProfile $SemanticQualityProfile `
            -ImagesDir $pageDirectory `
            -CandidateFile $blindMarkdownPath `
            -SemanticFindingsFile $semanticFindingsPath `
            -IncludeSourceText
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $semanticMergeArguments
    }
    $phaseStates[$currentPhase].status = "completed"
    $currentPhase = $null
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
        $blindMarkdownPath,
        $semanticReviewMarkdownPath,
        $semanticReviewReportPath
    )

    $candidateForVisual = $semanticReviewMarkdownPath
    $candidateForReference = $candidateForVisual
    if (-not $SkipVisualAudit) {
        New-Item -ItemType Directory -Force -Path $visualAuditPageDirectory | Out-Null
        Write-Host "[live-answer-workflow] render high-resolution source pages for no-reference visual audit"
        $visualAuditRenderArguments = @(
            $sourcePath,
            "--out", $visualAuditPageDirectory,
            "--pages", "all",
            "--scale", $VisualAuditScale.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--question-regions",
            "--horizontal-tiles", "2",
            "--tile-overlap", "0.15"
        )
        if ($visualAuditFocusRegionsPath) {
            $visualAuditRenderArguments += @("--focus-regions-file", $visualAuditFocusRegionsPath)
        }
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/review-source-pdf.mjs") -Arguments $visualAuditRenderArguments

        $currentPhase = "visualFindings"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        if ($resumeProvenance -and (Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $visualFindingsSummaryPath -DestinationArtifactPath $visualAuditFindingsPath)) {
            Write-Host "[live-answer-workflow] resume hash-bound visual findings without repeating audit"
        }
        else {
            Write-Host "[live-answer-workflow] extract visual findings without rewriting the blind candidate"
            $visualFindingsArguments = New-AnswerRequestArguments `
                -OutputPath $visualAuditFindingsPath `
                -SummaryPath $visualFindingsSummaryPath `
                -QualityProfile $VisualQualityProfile `
                -CandidateFile $candidateForVisual `
                -AuditImagesDir $visualAuditPageDirectory `
                -AuditFindingsOnly `
                -IncludeVisualDetail
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $visualFindingsArguments
        }
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
        $currentPhase = "visualMerge"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        if ($resumeProvenance -and (Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $visualMergeSummaryPath -DestinationArtifactPath $visualAuditMarkdownPath)) {
            Write-Host "[live-answer-workflow] resume hash-bound visual merge without repeating audit"
        }
        else {
            Write-Host "[live-answer-workflow] merge visual findings into the complete answer Markdown"
            $visualMergeArguments = New-AnswerRequestArguments `
                -OutputPath $visualAuditMarkdownPath `
                -SummaryPath $visualMergeSummaryPath `
                -QualityProfile $VisualQualityProfile `
                -CandidateFile $candidateForVisual `
                -AuditFindingsFile $visualAuditFindingsPath
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $visualMergeArguments
        }
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $candidateForVisual,
            $visualAuditMarkdownPath,
            $visualAuditReportPath
        )
        $candidateForReference = $visualAuditMarkdownPath
        if (-not $referencePath) {
            Copy-WorkflowFileAtomic -SourcePath $visualAuditMarkdownPath -DestinationPath $answerMarkdownPath
        }
    }
    if ($SkipVisualAudit -and -not $referencePath) {
        Copy-WorkflowFileAtomic -SourcePath $semanticReviewMarkdownPath -DestinationPath $answerMarkdownPath
    }

    if ($referencePath) {
        New-Item -ItemType Directory -Force -Path $referencePageDirectory | Out-Null
        Write-Host "[live-answer-workflow] render reference answer PDF"
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/review-source-pdf.mjs") -Arguments @(
            $referencePath,
            "--out", $referencePageDirectory,
            "--pages", "all",
            "--scale", $ReviewScale.ToString([Globalization.CultureInfo]::InvariantCulture)
        )
        $referenceTextLayers = @(Get-ChildItem -LiteralPath $referencePageDirectory -Filter "*.text-layer.txt" -File | Sort-Object Name)
        if ($referenceTextLayers.Count -gt 0) {
            $referenceText = ($referenceTextLayers | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n`n--- reference page ---`n`n"
            Set-Content -LiteralPath $referenceTextPath -Value $referenceText -Encoding utf8 -NoNewline
        }

        $currentPhase = "referenceReview"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        if ($resumeProvenance -and (Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $currentPhase -DestinationSummaryPath $referenceReviewSummaryPath -DestinationArtifactPath $answerMarkdownPath)) {
            Write-Host "[live-answer-workflow] resume hash-bound reference review without repeating comparison"
        }
        else {
            Write-Host "[live-answer-workflow] review blind candidate against authoritative reference"
            $reviewArguments = New-AnswerRequestArguments `
                -OutputPath $answerMarkdownPath `
                -SummaryPath $referenceReviewSummaryPath `
                -QualityProfile $ReferenceQualityProfile `
                -ImagesDir $pageDirectory `
                -CandidateFile $candidateForReference `
                -ReferenceImagesDir $referencePageDirectory `
                -ReferenceTextFile $referenceTextPath `
                -IncludeVisualDetail `
                -IncludeSourceText
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $reviewArguments
        }
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $candidateForReference,
            $answerMarkdownPath,
            $comparisonReportPath
        )
    }

    Write-Host "[live-answer-workflow] validate and render answer delivery"
    $currentPhase = "delivery"
    $phaseStates[$currentPhase].status = "in_progress"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    $deliveryArguments = @(
        $answerMarkdownPath,
        $answerPdfPath,
        "--subject-pack", $SubjectPack,
        "--profile", $Profile,
        "--review-scale", $ReviewScale.ToString([Globalization.CultureInfo]::InvariantCulture)
    )
    if ($KeepReview) {
        $deliveryArguments += "--keep-review"
    }
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/deliver-answer.mjs") -Arguments $deliveryArguments
    $phaseStates[$currentPhase].status = "completed"
    $currentPhase = $null

    if ($SkipVisualAudit) {
        foreach ($stalePath in @($visualAuditMarkdownPath, $visualAuditFindingsPath, $visualAuditReportPath)) {
            Remove-Item -LiteralPath $stalePath -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not $referencePath) {
        Remove-Item -LiteralPath $comparisonReportPath -Force -ErrorAction SilentlyContinue
    }
    if ($SkipVisualAudit -and -not $referencePath) {
        Remove-Item -LiteralPath $blindMarkdownPath -Force -ErrorAction SilentlyContinue
    }

    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    Write-WorkflowReceipt -Status "succeeded"

    $workflowSucceeded = $true
    Write-Host "[live-answer-workflow] complete"
    Write-Host "Markdown: $answerMarkdownPath"
    if ($referencePath) {
        Write-Host "Blind candidate: $blindMarkdownPath"
        Write-Host "Semantic findings: $semanticFindingsPath"
        Write-Host "Semantic review candidate: $semanticReviewMarkdownPath"
        Write-Host "Comparison report: $comparisonReportPath"
    }
    Write-Host "Semantic review report: $semanticReviewReportPath"
    if (-not $SkipVisualAudit) {
        Write-Host "Visual audit findings: $visualAuditFindingsPath"
        Write-Host "Visual audit candidate: $visualAuditMarkdownPath"
        Write-Host "Blind/audit report: $visualAuditReportPath"
    }
    Write-Host "PDF: $answerPdfPath"
    Write-Host "Workflow receipt: $workflowReceiptPath"
}
catch {
    $failure = $_
    if ($currentPhase -and $phaseStates[$currentPhase].status -eq "in_progress") {
        $phaseStates[$currentPhase].status = "failed"
        $phaseStates[$currentPhase].error = $failure.Exception.Message
    }
    try {
        Write-WorkflowReceipt -Status "failed" -ErrorMessage $failure.Exception.Message
        Write-Warning "Workflow failure receipt: $workflowReceiptPath"
    }
    catch {
        Write-Warning "Unable to write workflow failure receipt: $($_.Exception.Message)"
    }
    throw $failure
}
finally {
    if ($null -eq $previousCloudEgress) {
        Remove-Item Env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED -ErrorAction SilentlyContinue
    }
    else {
        $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = $previousCloudEgress
    }

    if ($null -eq $previousNodeOptions) {
        Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    }
    else {
        $env:NODE_OPTIONS = $previousNodeOptions
    }
    if ($null -eq $previousNoProxy) {
        Remove-Item Env:NO_PROXY -ErrorAction SilentlyContinue
    }
    else {
        $env:NO_PROXY = $previousNoProxy
    }

    if ($workflowSucceeded -and (Test-Path -LiteralPath $workRoot)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
    elseif (Test-Path -LiteralPath $workRoot) {
        Write-Warning "Workflow failed; retained diagnostics: $workRoot"
    }
}
