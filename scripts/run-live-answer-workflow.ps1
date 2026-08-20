[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePdf,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$ReferencePdf,

    [string]$PromptFile = "prompts/junior-physics-answer/spec.md",
    [string]$ConfigEnvFile = ".env",

    [ValidateSet("primary", "fallback", "all")]
    [string]$Provider = "all",

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
            (($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
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
$promptPath = Resolve-WorkflowPath $PromptFile
$envFilePath = Resolve-WorkflowPath $ConfigEnvFile

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Source PDF not found: $sourcePath"
}

if (-not (Test-Path -LiteralPath $promptPath -PathType Leaf)) {
    throw "Prompt file not found: $promptPath"
}

if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
    throw "Gateway env file not found: $envFilePath"
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
$answerMarkdownPath = Join-Path $outputRoot "${baseName}参考答案.md"
$blindMarkdownPath = Join-Path $outputRoot "${baseName}盲答候选.md"
$visualAuditMarkdownPath = Join-Path $outputRoot "${baseName}视觉审计候选.md"
$visualAuditFindingsPath = Join-Path $outputRoot "${baseName}视觉审计发现.md"
$answerPdfPath = Join-Path $outputRoot "${baseName}参考答案.pdf"
$comparisonReportPath = Join-Path $outputRoot "${baseName}答案自动复核文本差异报告.md"
$visualAuditReportPath = Join-Path $outputRoot "${baseName}盲答与视觉审计差异报告.md"
$blindSummaryPath = Join-Path $outputRoot "${baseName}.blind-generation.summary.json"
$visualFindingsSummaryPath = Join-Path $outputRoot "${baseName}.visual-findings.summary.json"
$visualMergeSummaryPath = Join-Path $outputRoot "${baseName}.visual-merge.summary.json"
$referenceReviewSummaryPath = Join-Path $outputRoot "${baseName}.reference-review.summary.json"
$workflowReceiptPath = Join-Path $outputRoot "${baseName}.workflow-run.json"
$deliveryManifestPath = Join-Path $outputRoot "${baseName}参考答案.delivery-manifest.json"
$deliverySnapshotPath = Join-Path $outputRoot "${baseName}参考答案.snapshot.json"
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
$workflowRunId = [Guid]::NewGuid().ToString("N")
$workflowStartedAt = [DateTimeOffset]::UtcNow
$currentPhase = $null

if ($referencePath -and -not (Test-Path -LiteralPath $referencePath -PathType Leaf)) {
    throw "Reference PDF not found: $referencePath"
}

$workflowInputReceipts = [ordered]@{
    SourcePdf = Get-WorkflowFileReceipt -PathValue $sourcePath
    ReferencePdf = Get-WorkflowFileReceipt -PathValue $referencePath
    PromptFile = Get-WorkflowFileReceipt -PathValue $promptPath
}

Assert-WorkflowOutputDoesNotOverwriteInput -Inputs @{
    SourcePdf = $sourcePath
    ReferencePdf = $referencePath
    PromptFile = $promptPath
    ConfigEnvFile = $envFilePath
} -Outputs @{
    AnswerMarkdown = $answerMarkdownPath
    BlindMarkdown = $blindMarkdownPath
    VisualAuditMarkdown = $visualAuditMarkdownPath
    VisualAuditFindings = $visualAuditFindingsPath
    AnswerPdf = $answerPdfPath
    ComparisonReport = $comparisonReportPath
    VisualAuditReport = $visualAuditReportPath
    BlindSummary = $blindSummaryPath
    VisualFindingsSummary = $visualFindingsSummaryPath
    VisualMergeSummary = $visualMergeSummaryPath
    ReferenceReviewSummary = $referenceReviewSummaryPath
    WorkflowReceipt = $workflowReceiptPath
    DeliveryManifest = $deliveryManifestPath
    DeliverySnapshot = $deliverySnapshotPath
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$generationOutputPath = if ($referencePath -or -not $SkipVisualAudit) { $blindMarkdownPath } else { $answerMarkdownPath }
$phaseStates = [ordered]@{
    blindGeneration = [ordered]@{ status = "pending"; summaryPath = $blindSummaryPath; artifactPath = $generationOutputPath }
    visualFindings = [ordered]@{ status = $(if ($SkipVisualAudit) { "skipped" } else { "pending" }); summaryPath = $visualFindingsSummaryPath; artifactPath = $visualAuditFindingsPath }
    visualMerge = [ordered]@{ status = $(if ($SkipVisualAudit) { "skipped" } else { "pending" }); summaryPath = $visualMergeSummaryPath; artifactPath = $visualAuditMarkdownPath }
    referenceReview = [ordered]@{ status = $(if ($referencePath) { "pending" } else { "skipped" }); summaryPath = $referenceReviewSummaryPath; artifactPath = $answerMarkdownPath }
    delivery = [ordered]@{ status = "pending"; summaryPath = $null; artifactPath = $answerPdfPath }
}

foreach ($summaryPath in @($blindSummaryPath, $visualFindingsSummaryPath, $visualMergeSummaryPath, $referenceReviewSummaryPath, $workflowReceiptPath)) {
    Remove-Item -LiteralPath $summaryPath -Force -ErrorAction SilentlyContinue
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
                $(if (-not $SkipVisualAudit) { $blindMarkdownPath; $visualAuditFindingsPath; $visualAuditMarkdownPath; $visualAuditReportPath }),
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
        }
        options = [ordered]@{
            provider = $Provider
            profile = $Profile
            visualDetail = $VisualDetail
            maxOutputTokens = $MaxOutputTokens
            timeoutMs = $TimeoutMs
            reviewScale = $ReviewScale
            visualAuditScale = $VisualAuditScale
            skipVisualAudit = [bool]$SkipVisualAudit
            keepReview = [bool]$KeepReview
            useGatewayProxy = [bool]$UseGatewayProxy
        }
        phases = $phaseReceipts
        artifacts = $artifacts
        diagnostics = [ordered]@{
            retainedWorkRoot = $(if ($Status -eq "failed") { $workRoot } else { $null })
        }
        error = $(if ([string]::IsNullOrWhiteSpace($ErrorMessage)) { $null } else { $ErrorMessage })
    }

    Write-JsonFileAtomic -PathValue $workflowReceiptPath -Value $receipt
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

    & node $ScriptPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Node tool failed with exit code $LASTEXITCODE`: $ScriptPath"
    }
}

try {
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    New-Item -ItemType Directory -Force -Path $pageDirectory | Out-Null

    Write-Host "[live-answer-workflow] render source PDF pages"
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/review-source-pdf.mjs") -Arguments @(
        $sourcePath,
        "--out", $pageDirectory,
        "--pages", "all",
        "--scale", $ReviewScale.ToString([Globalization.CultureInfo]::InvariantCulture)
    )

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

    Write-Host "[live-answer-workflow] generate answer Markdown from $($pageImages.Count) page(s)"
    $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
    $currentPhase = "blindGeneration"
    $phaseStates[$currentPhase].status = "in_progress"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    $blindArguments = @(
        "--config-env-file", $envFilePath,
        "--prompt-file", $promptPath,
        "--images-dir", $pageDirectory,
        "--output", $generationOutputPath,
        "--summary-out", $blindSummaryPath,
        "--provider", $Provider,
        "--visual-detail", $VisualDetail,
        "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--allow-cloud-egress"
    )
    if (Test-Path -LiteralPath $sourceTextPath -PathType Leaf) {
        $blindArguments += @("--source-text-file", $sourceTextPath)
    }
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $blindArguments
    $phaseStates[$currentPhase].status = "completed"
    $currentPhase = $null

    $candidateForReference = $blindMarkdownPath
    if (-not $SkipVisualAudit) {
        New-Item -ItemType Directory -Force -Path $visualAuditPageDirectory | Out-Null
        Write-Host "[live-answer-workflow] render high-resolution source pages for no-reference visual audit"
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/review-source-pdf.mjs") -Arguments @(
            $sourcePath,
            "--out", $visualAuditPageDirectory,
            "--pages", "all",
            "--scale", $VisualAuditScale.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--question-regions",
            "--horizontal-tiles", "2",
            "--tile-overlap", "0.15"
        )

        Write-Host "[live-answer-workflow] extract visual findings without rewriting the blind candidate"
        $currentPhase = "visualFindings"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments @(
            "--config-env-file", $envFilePath,
            "--prompt-file", $promptPath,
            "--candidate-file", $blindMarkdownPath,
            "--audit-images-dir", $visualAuditPageDirectory,
            "--audit-findings-only",
            "--output", $visualAuditFindingsPath,
            "--summary-out", $visualFindingsSummaryPath,
            "--provider", $Provider,
            "--visual-detail", $VisualDetail,
            "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--allow-cloud-egress"
        )
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
        Write-Host "[live-answer-workflow] merge visual findings into the complete answer Markdown"
        $currentPhase = "visualMerge"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments @(
            "--config-env-file", $envFilePath,
            "--prompt-file", $promptPath,
            "--candidate-file", $blindMarkdownPath,
            "--audit-findings-file", $visualAuditFindingsPath,
            "--output", $visualAuditMarkdownPath,
            "--summary-out", $visualMergeSummaryPath,
            "--provider", $Provider,
            "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--allow-cloud-egress"
        )
        $phaseStates[$currentPhase].status = "completed"
        $currentPhase = $null
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $blindMarkdownPath,
            $visualAuditMarkdownPath,
            $visualAuditReportPath
        )
        $candidateForReference = $visualAuditMarkdownPath
        if (-not $referencePath) {
            Copy-WorkflowFileAtomic -SourcePath $visualAuditMarkdownPath -DestinationPath $answerMarkdownPath
        }
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

        Write-Host "[live-answer-workflow] review blind candidate against authoritative reference"
        $currentPhase = "referenceReview"
        $phaseStates[$currentPhase].status = "in_progress"
        Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
        $reviewArguments = @(
            "--config-env-file", $envFilePath,
            "--prompt-file", $promptPath,
            "--images-dir", $pageDirectory,
            "--candidate-file", $candidateForReference,
            "--reference-images-dir", $referencePageDirectory,
            "--output", $answerMarkdownPath,
            "--summary-out", $referenceReviewSummaryPath,
            "--provider", $Provider,
            "--visual-detail", $VisualDetail,
            "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--allow-cloud-egress"
        )
        if (Test-Path -LiteralPath $sourceTextPath -PathType Leaf) {
            $reviewArguments += @("--source-text-file", $sourceTextPath)
        }
        if (Test-Path -LiteralPath $referenceTextPath -PathType Leaf) {
            $reviewArguments += @("--reference-text-file", $referenceTextPath)
        }
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $reviewArguments
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
        "--subject-pack", "junior-physics-answer",
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
        Write-Host "Comparison report: $comparisonReportPath"
    }
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
