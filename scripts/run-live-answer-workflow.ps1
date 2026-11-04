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

    [ValidateSet("auto", "sol-high", "sol-medium", "sol-low", "terra-max", "terra-xhigh", "terra-high", "luna-max", "luna-xhigh", "luna-high")]
    [string]$BlindQualityProfile = "auto",

    [ValidateSet("auto", "sol-high", "sol-medium", "sol-low", "terra-max", "terra-xhigh", "terra-high", "luna-max", "luna-xhigh", "luna-high")]
    [string]$SemanticQualityProfile = "auto",

    [ValidateSet("auto", "sol-high", "sol-medium", "sol-low", "terra-max", "terra-xhigh", "terra-high", "luna-max", "luna-xhigh", "luna-high")]
    [string]$VisualQualityProfile = "auto",

    [ValidateSet("auto", "sol-high", "sol-medium", "sol-low", "terra-max", "terra-xhigh", "terra-high", "luna-max", "luna-xhigh", "luna-high")]
    [string]$ReferenceQualityProfile = "auto",

    [ValidateSet("classroom", "compact")]
    [string]$Profile = "classroom",

    [ValidateRange(1.0, 8.0)]
    [double]$WorkflowReviewScale = 2.0,

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

    [switch]$AllowCloudEgress,

    [switch]$KeepReview
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot

# Packaged runtimes ship Node beside the scripts, and the WPF host does not
# extend PATH for its child processes. Resolve the bundled binary (or an
# explicit override) before falling back to PATH so a teacher machine without
# a development Node installation can still run the full workflow.
function Get-WorkflowNodeExecutable {
    if (-not [string]::IsNullOrWhiteSpace($env:CLASSROOM_TOOLKIT_NODE_PATH)) {
        return $env:CLASSROOM_TOOLKIT_NODE_PATH
    }
    foreach ($candidate in @(
            (Join-Path $repoRoot "runtime/node/node.exe"),
            (Join-Path $repoRoot "runtime/node/node")
        )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    return "node"
}
$workflowNodeExecutable = Get-WorkflowNodeExecutable

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
            $resolvedInput = [IO.Path]::GetFullPath($inputPath)
            $resolvedOutput = [IO.Path]::GetFullPath($outputPath)
            $directoryOutput = $outputName -eq "DeliveryReview" -or (Test-Path -LiteralPath $resolvedOutput -PathType Container)
            if ([string]::Equals(
                    $resolvedInput,
                    $resolvedOutput,
                    [StringComparison]::OrdinalIgnoreCase) -or
                ($directoryOutput -and $resolvedInput.StartsWith(
                    $resolvedOutput.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar,
                    [StringComparison]::OrdinalIgnoreCase))) {
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
        [Parameter(Mandatory = $true)]$ExpectedReceipt
    )

    # Renderer prompts are a historical set. Files such as answer-tasks.mjs may
    # be replaced by a self-update after a paid stage; the prompt and other
    # actual evidence inputs must still be frozen.
    if ($InputName -eq "RendererPrompts") {
        return
    }
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
        [AllowNull()][System.Collections.IDictionary]$ExpectedReceipt,
        [AllowNull()][System.Collections.IDictionary]$ActualReceipt
    )

    if ($null -eq $ExpectedReceipt -or $null -eq $ActualReceipt) {
        return $null -eq $ExpectedReceipt -and $null -eq $ActualReceipt
    }

    return ($ExpectedReceipt.path -eq $ActualReceipt.path -and
        $ExpectedReceipt.bytes -eq $ActualReceipt.bytes -and
        $ExpectedReceipt.sha256 -eq $ActualReceipt.sha256)
}

function ConvertTo-WorkflowOptionValue {
    param([AllowNull()]$Value)

    # Ordered options are the canonical representation for both the current
    # options fingerprint and resume comparison. ConvertFrom-Json turns nested
    # file names into strings and booleans into strings or booleans depending
    # on serialization, so use a strict textual representation instead.
    return ($Value | ConvertTo-Json -Compress -Depth 10)
}

function Test-WorkflowOptionValuesEqual {
    param(
        [AllowNull()]$Left,
        [AllowNull()]$Right
    )

    $leftNumber = 0.0
    $rightNumber = 0.0
    if ([double]::TryParse([string]$Left, [Globalization.NumberStyles]::Float,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$leftNumber) -and
        [double]::TryParse([string]$Right, [Globalization.NumberStyles]::Float,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$rightNumber)) {
        return $leftNumber -eq $rightNumber
    }
    return (ConvertTo-WorkflowOptionValue $Left) -eq (ConvertTo-WorkflowOptionValue $Right)
}

function Get-OptionalJsonProperty {
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }
    if ($Object -is [System.Collections.IDictionary]) {
        return $(if ($Object.Contains($Name)) { $Object[$Name] } else { $null })
    }
    if (-not $Object.PSObject.Properties.Match($Name)) {
        return $null
    }
    return $Object.PSObject.Properties.Match($Name)[0].Value
}

function Assert-NoWorkflowManifestReferenceLeak {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Outputs
    )

    $leaks = [Collections.Generic.List[string]]::new()
    foreach ($outputName in $Outputs.Keys) {
        $outputPath = $Outputs[$outputName]
        if ([string]::IsNullOrWhiteSpace($outputPath) -or
            -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
            continue
        }
        try {
            $value = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
            $stack = [Collections.Generic.Stack[object]]::new()
            $stack.Push($value)
            while ($stack.Count -gt 0) {
                $current = $stack.Pop()
                if ($current -is [string]) {
                    if ($current -match '(?i)\.env(?:$|[\\/])' -or
                        $current -match '(?i)CLASSROOM_TOOLKIT_[A-Z0-9_]*KEY|TEXT_PROVIDER_|sk-[A-Za-z0-9]|bearer') {
                        $leaks.Add("$outputName contains a configuration/secret reference.")
                    }
                }
                elseif ($current -is [System.Collections.IDictionary]) {
                    foreach ($item in $current.Values) { $stack.Push($item) }
                }
                elseif ($current -is [System.Collections.IEnumerable]) {
                    foreach ($item in $current) { $stack.Push($item) }
                }
                elseif ($null -ne $current -and $current -isnot [ValueType]) {
                    foreach ($property in $current.PSObject.Properties) {
                        $stack.Push($property.Value)
                    }
                }
            }
        }
        catch {
            # Markdown and binary outputs are not JSON manifests and are covered
            # by their own validators. Never infer secret contents from this scan.
        }
    }
    if ($leaks.Count -gt 0) {
        throw ($leaks | Select-Object -Unique) -join [Environment]::NewLine
    }
}

function Assert-NoWorkflowManifestConfigReference {
    param([Parameter(Mandatory = $true)][hashtable]$Outputs)

    foreach ($outputName in $Outputs.Keys) {
        $outputPath = $Outputs[$outputName]
        if ([string]::IsNullOrWhiteSpace($outputPath) -or
            -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
            continue
        }
        try {
            $document = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
            $stack = [Collections.Generic.Stack[object]]::new()
            $stack.Push($document)
            while ($stack.Count -gt 0) {
                $current = $stack.Pop()
                if ($current -is [string]) {
                    $normalized = $current.Replace("\", "/")
                    if ($normalized -match '(?i)(?:^|/)\.env(?:$|/)') {
                        throw "Workflow manifest $outputName must not embed the configured .env path."
                    }
                }
                elseif ($current -is [System.Collections.IDictionary]) {
                    foreach ($item in $current.Values) { $stack.Push($item) }
                }
                elseif ($current -is [System.Collections.IEnumerable]) {
                    foreach ($item in $current) { $stack.Push($item) }
                }
                elseif ($null -ne $current -and $current -isnot [ValueType]) {
                    foreach ($property in $current.PSObject.Properties) {
                        $stack.Push($property.Value)
                    }
                }
            }
        }
        catch {
            if ($_.Exception.Message -like "Workflow manifest *") {
                throw
            }
        }
    }
}

function Assert-ResumeBlindGeneration {
    param(
        [Parameter(Mandatory = $true)][string]$ReceiptPath,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$CurrentInputs,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$CurrentOptions,
        [Parameter(Mandatory = $true)][string]$CurrentOptionsFingerprint
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
        ConfigEnvFile = "configEnv"
    }

    # The top-level receipt is parsed as a hashtable, but fixtures written by
    # older workflows may carry PSCustomObject values. Normalize only at this
    # compatibility boundary so a valid legacy receipt remains resumable.
    $priorOptions = if ($resumeReceipt.options -is [System.Collections.IDictionary]) {
        $resumeReceipt.options
    }
    elseif ($null -ne $resumeReceipt.options) {
        $legacyOptions = @{}
        foreach ($property in $resumeReceipt.options.PSObject.Properties) {
            $legacyOptions[$property.Name] = $property.Value
        }
        $legacyOptions
    }
    else {
        $null
    }
    if ($null -eq $priorOptions) {
        throw "Resume workflow receipt has no options binding; start a new run: $ReceiptPath"
    }
    foreach ($optionName in $CurrentOptions.Keys) {
        if ($optionName -eq "allowCloudEgress" -and
            -not $priorOptions.ContainsKey("allowCloudEgress")) {
            # Older receipts predate this explicit authorization. Their source
            # implementation opened cloud egress unconditionally, so preserving
            # that option boundary keeps their hash-bound blind candidate usable.
            continue
        }
        # A receipt written by an older workflow has no scale split. Use the
        # historical ReviewScale for both delivery and workflow review in that
        # compatibility case; all current receipts record both values.
        $hasPriorValue = $priorOptions.Contains($optionName)
        $priorValue = if ($optionName -eq "workflowReviewScale" -and -not $hasPriorValue) {
            $priorOptions["reviewScale"]
        }
        else {
            $priorOptions[$optionName]
        }
        $optionMismatch = (
            (-not $hasPriorValue -and
                -not ($optionName -eq "workflowReviewScale" -and $priorOptions.Contains("reviewScale"))) -or
            -not (Test-WorkflowOptionValuesEqual $priorValue $CurrentOptions[$optionName])
        )
        if ($optionMismatch) {
            throw "Resume workflow option does not match current $optionName`: $ReceiptPath"
        }
    }
    # Legacy compatibility: pre-egress receipts have neither the new explicit
    # option nor a fingerprint. Their candidate is accepted only after all
    # available current option fields and every bound input still match.
    $hasFingerprint = $priorOptions.Contains("optionsFingerprint")
    if ($hasFingerprint -and $priorOptions.optionsFingerprint -ne $CurrentOptionsFingerprint) {
        throw "Resume workflow options fingerprint does not match current options: $ReceiptPath"
    }
    foreach ($inputName in $inputNameMap.Keys) {
        $priorReceipt = $resumeReceipt.inputs[$inputNameMap[$inputName]]
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $priorReceipt -ActualReceipt $CurrentInputs[$inputName])) {
            throw "Resume workflow input does not match current $inputName`: $ReceiptPath"
        }
    }

    $priorPhases = if ($resumeReceipt.phases -is [System.Collections.IDictionary]) {
        $resumeReceipt.phases
    }
    else {
        $legacyPhases = @{}
        foreach ($property in $resumeReceipt.phases.PSObject.Properties) {
            $legacyPhases[$property.Name] = $property.Value
        }
        $legacyPhases
    }
    $blindPhase = Get-OptionalJsonProperty $priorPhases "blindGeneration"
    if ($null -eq $blindPhase -or
        (Get-OptionalJsonProperty $blindPhase "status") -ne "completed") {
        throw "Resume workflow receipt has no completed blindGeneration phase: $ReceiptPath"
    }
    foreach ($kind in @("summary", "artifact")) {
        $boundReceipt = Get-OptionalJsonProperty $blindPhase $kind
        $boundPath = Get-OptionalJsonProperty $boundReceipt "path"
        if ($null -eq $boundReceipt -or [string]::IsNullOrWhiteSpace([string]$boundPath) -or
            -not (Test-Path -LiteralPath ([string]$boundPath) -PathType Leaf)) {
            throw "Resume blindGeneration $kind is missing: $ReceiptPath"
        }
        $actualReceipt = Get-WorkflowFileReceipt -PathValue ([string]$boundPath)
        $expectedReceipt = @{
            path = [string]$boundPath
            bytes = [long](Get-OptionalJsonProperty $boundReceipt "bytes")
            sha256 = [string](Get-OptionalJsonProperty $boundReceipt "sha256")
        }
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $expectedReceipt -ActualReceipt $actualReceipt)) {
            throw "Resume blindGeneration $kind hash mismatch: $boundPath"
        }
    }

    return [ordered]@{
        workflowReceipt = Get-WorkflowFileReceipt -PathValue $ReceiptPath
        phases = $priorPhases
        blindGeneration = [ordered]@{
            summary = Get-OptionalJsonProperty $blindPhase "summary"
            artifact = Get-OptionalJsonProperty $blindPhase "artifact"
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

    $phase = Get-OptionalJsonProperty $ResumeProvenance.phases $PhaseName
    if ($null -eq $phase -or
        (Get-OptionalJsonProperty $phase "status") -ne "completed") {
        return $false
    }

    foreach ($kind in @("artifact", $(if ($DestinationSummaryPath) { "summary" }))) {
        $boundReceipt = Get-OptionalJsonProperty $phase $kind
        $boundPath = Get-OptionalJsonProperty $boundReceipt "path"
        if ($null -eq $boundReceipt -or [string]::IsNullOrWhiteSpace([string]$boundPath) -or
            -not (Test-Path -LiteralPath ([string]$boundPath) -PathType Leaf)) {
            throw "Resume $PhaseName $kind is missing: $($ResumeProvenance.workflowReceipt.path)"
        }
        $actualReceipt = Get-WorkflowFileReceipt -PathValue ([string]$boundPath)
        $expectedReceipt = @{
            path = [string]$boundPath
            bytes = [long](Get-OptionalJsonProperty $boundReceipt "bytes")
            sha256 = [string](Get-OptionalJsonProperty $boundReceipt "sha256")
        }
        if (-not (Test-WorkflowFileReceiptMatches -ExpectedReceipt $expectedReceipt -ActualReceipt $actualReceipt)) {
            throw "Resume $PhaseName $kind hash mismatch: $boundPath"
        }
    }

    Copy-WorkflowFileAtomic -SourcePath ([string](Get-OptionalJsonProperty $phase.artifact "path")) -DestinationPath $DestinationArtifactPath
    if ($DestinationSummaryPath) {
        Copy-WorkflowFileAtomic -SourcePath ([string](Get-OptionalJsonProperty $phase.summary "path")) -DestinationPath $DestinationSummaryPath
    }
    $script:reusedResumePhaseNames += $PhaseName
    return $true
}

function Invoke-NodeTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    # Stream lines as they arrive so a multi-minute AI stage no longer reads as
    # a hung shell; the same transcript still feeds the failure diagnostics.
    $toolOutput = [Collections.Generic.List[string]]::new()
    & $workflowNodeExecutable $ScriptPath @Arguments 2>&1 | ForEach-Object {
        $line = $_.ToString()
        $toolOutput.Add($line)
        Write-Output $line
    }
    $toolExitCode = $LASTEXITCODE
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

function Get-WorkflowQuestionNumbers {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        return @()
    }
    # The lookahead rejects decimal values such as "0.5" or "10.5 m" that start
    # a line, which otherwise register as phantom question numbers.
    $numbers = @(Get-Content -LiteralPath $PathValue -Raw |
        Select-String -AllMatches -Pattern '(?m)^\s*(?:#{1,3}\s*)?(?:第\s*)?(\d{1,3})\s*(?:题|[.．、])(?!\d)' |
        ForEach-Object { $_.Matches } |
        ForEach-Object { [int]$_.Groups[1].Value } |
        Sort-Object -Unique)
    return @($numbers)
}

function Get-WorkflowReviewEvidence {
    param([Parameter(Mandatory = $true)][string]$AnswerMarkdownPath)

    $semantic = if (Test-Path -LiteralPath $semanticReviewEvidencePath -PathType Leaf) {
        Get-Content -LiteralPath $semanticReviewEvidencePath -Raw | ConvertFrom-Json
    }
    else {
        $null
    }
    $reference = if ($referenceUsed -and (Test-Path -LiteralPath $referenceReviewEvidencePath -PathType Leaf)) {
        Get-Content -LiteralPath $referenceReviewEvidencePath -Raw | ConvertFrom-Json
    }
    else {
        $null
    }
    $answerQuestions = @(Get-WorkflowQuestionNumbers -PathValue $AnswerMarkdownPath)
    $semanticUnresolved = if ($semantic) {
        @($semantic.unresolvedQuestions)
    }
    else {
        @()
    }
    $visualUnresolved = if ($SkipVisualAudit) {
        @()
    }
    else {
        @($answerQuestions)
    }
    $referenceUnresolved = if ($reference) {
        @($reference.unresolvedQuestions)
    }
    elseif ($referenceUsed) {
        @($answerQuestions)
    }
    else {
        @()
    }
    $evidenceQuestions = @($semanticUnresolved + $visualUnresolved + $referenceUnresolved |
        Sort-Object -Unique)
    $notices = [Collections.Generic.List[string]]::new()
    if ($SkipVisualAudit) {
        $notices.Add("visual audit was explicitly skipped; delivery is not visual-audited")
    }
    if (-not $referenceUsed -and $referencePath) {
        $notices.Add("authoritative reference was supplied but no reference review ran")
    }
    return [ordered]@{
        semantic = [ordered]@{
            confirmedCorrections = $(if ($semantic) { @($semantic.confirmedCorrections) } else { @() })
            unresolvedQuestions = @($semanticUnresolved)
        }
        visual = [ordered]@{
            directCorrections = $(if ($semantic) { @($semantic.directCorrections) } else { @() })
            unresolvedQuestions = @($visualUnresolved)
        }
        reference = [ordered]@{
            correctedQuestions = $(if ($reference) {
                @($reference.directCorrections | Sort-Object -Unique)
            }
            else {
                @()
            })
            unresolvedQuestions = @($referenceUnresolved)
        }
        unresolvedQuestions = @($evidenceQuestions)
        unresolvedReviewNotices = @($notices)
    }
}

# Single seam for running one tracked workflow phase: input-drift assertion,
# hash-bound resume, execution, and the in_progress/completed state machine.
# A failed Execute propagates so the top-level catch marks the phase failed;
# phases without -SummaryPath (delivery) are never resume candidates.
# $currentPhase is script-scoped so a mid-phase failure is visible to the catch.
function Invoke-WorkflowPhase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ExecuteMessage,
        [Parameter(Mandatory = $true)][scriptblock]$Execute,
        [string]$ResumeMessage,
        [string]$SummaryPath,
        [Parameter(Mandatory = $true)][string]$ArtifactPath
    )

    $script:currentPhase = $Name
    $phaseStates[$Name].status = "in_progress"
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    $candidateFile = switch ($Name) {
        "blindGeneration" { $null }
        "semanticFindings" { $blindMarkdownPath }
        "semanticMerge" { $blindMarkdownPath }
        "visualFindings" { $semanticReviewMarkdownPath }
        "visualMerge" { $semanticReviewMarkdownPath }
        "referenceReview" { $candidateForReference }
        default { $null }
    }
    $candidateBaselineFile = switch ($Name) {
        "semanticFindings" { $blindMarkdownPath }
        "semanticMerge" { $blindEvidencePath }
        "visualFindings" { $semanticReviewMarkdownPath }
        "visualMerge" { $semanticReviewMarkdownPath }
        "referenceReview" { $candidateForReference }
        default { $null }
    }
    $resumed = $false
    if ($resumeProvenance -and $SummaryPath) {
        $resumed = Copy-ResumePhaseArtifacts -ResumeProvenance $resumeProvenance -PhaseName $Name `
            -DestinationSummaryPath $SummaryPath -DestinationArtifactPath $ArtifactPath
    }
    if ($resumed) {
        Write-Host $ResumeMessage
    }
    else {
        Write-Host $ExecuteMessage
        # A resumed phase is already bound to its completed artifact. Only a
        # fresh execution unlocks the output tuple.
        & $Execute
    }
    if ($Name -ne "delivery") {
        if (-not (Test-Path -LiteralPath $SummaryPath -PathType Leaf)) {
            throw "Workflow phase $Name completed without a summary: $SummaryPath"
        }
        if (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
            throw "Workflow phase $Name completed without its artifact: $ArtifactPath"
        }
        $summaryReceipt = Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json
        $expectedMode = switch ($Name) {
            "blindGeneration" { "blind_generation" }
            "semanticFindings" { "semantic_review_findings" }
            "semanticMerge" { "semantic_review_merge" }
            "visualFindings" { "visual_audit_findings" }
            "visualMerge" { "visual_audit_merge" }
            "referenceReview" { "reference_review" }
            default { throw "Unknown AI workflow phase: $Name" }
        }
        $summaryMode = Get-OptionalJsonProperty $summaryReceipt "mode"
        if ($summaryReceipt.kind -ne "live-answer-generation-summary" -or
            $summaryMode -ne $expectedMode) {
            throw "Workflow phase $Name summary has the wrong kind or mode: $SummaryPath (kind=$($summaryReceipt.kind); mode=$summaryMode; expected=$expectedMode)"
        }
        if ($Name -eq "referenceReview" -and $summaryReceipt.candidateBaselineSha256 -ne
            (Get-WorkflowFileReceipt -PathValue $candidateForReference).sha256) {
            throw "Reference review baseline does not match the candidate actually reviewed."
        }
        if ($Name -eq "referenceReview" -and
            $summaryReceipt.referencePdfSha256 -ne
                (Get-WorkflowFileReceipt -PathValue $referencePath).sha256) {
            throw "Reference review does not bind the selected authoritative reference PDF."
        }
        if ($Name -in @("semanticFindings", "semanticMerge", "visualFindings", "visualMerge", "referenceReview") -and
            $summaryReceipt.candidateSha256 -ne
                (Get-WorkflowFileReceipt -PathValue $candidateFile).sha256) {
            throw "Workflow phase $Name candidate does not match the file actually supplied."
        }
        if ($candidateBaselineFile -and
            $summaryReceipt.candidateBaselineSha256 -ne
                (Get-WorkflowFileReceipt -PathValue $candidateBaselineFile).sha256) {
            throw "Workflow phase $Name baseline does not match the reviewed candidate."
        }
        $artifactReceipt = Get-WorkflowFileReceipt -PathValue $ArtifactPath
        $summaryOutputPath = if ($resumed) {
            $priorPhase = Get-OptionalJsonProperty $ResumeProvenance.phases $Name
            [string](Get-OptionalJsonProperty (Get-OptionalJsonProperty $priorPhase "artifact") "path")
        }
        else {
            $ArtifactPath
        }
        if ($summaryReceipt.outputPath -ne $summaryOutputPath) {
            throw "Workflow phase $Name summary outputPath does not match its artifact: $summaryOutputPath"
        }
        if ($summaryReceipt.outputSha256 -ne $artifactReceipt.sha256) {
            throw "Workflow phase $Name summary output SHA-256 does not match its artifact: $ArtifactPath"
        }
        if ([int]$summaryReceipt.answerCharacters -le 0 -or
            ($summaryReceipt.attempts | Where-Object { $_.ok -eq $true }).Count -eq 0) {
            throw "Workflow phase $Name has no successful result with answer content."
        }
    }
    elseif (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
        throw "Workflow delivery phase completed without a PDF: $ArtifactPath"
    }
    $phaseStates[$Name].status = "completed"
    $script:currentPhase = $null
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
$subjectManifestPath = Join-Path $repoRoot "prompts/$SubjectPack/manifest.json"
if (-not (Test-Path -LiteralPath $subjectManifestPath -PathType Leaf)) {
    throw "Subject pack manifest not found: $subjectManifestPath"
}
$subjectManifest = Get-Content -LiteralPath $subjectManifestPath -Raw | ConvertFrom-Json
if ($subjectManifest.workflow.liveAnswers -ne $true) {
    throw "Subject pack '$SubjectPack' is not enabled for live answer workflows: $subjectManifestPath"
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
$semanticReviewEvidencePath = Join-Path $outputRoot "${baseName}.semantic-review-evidence.json"
$referenceReviewEvidencePath = Join-Path $outputRoot "${baseName}.reference-review-evidence.json"
$blindSummaryPath = Join-Path $outputRoot "${baseName}.blind-generation.summary.json"
$blindEvidencePath = Join-Path $outputRoot "${baseName}.blind-generation.evidence.json"
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
$previousNodeOptions = $env:NODE_OPTIONS
$previousNoProxy = $env:NO_PROXY
$processEgressWasSet = -not [string]::IsNullOrEmpty($env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED)
$previousEgressValue = $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
$referencePath = if ([string]::IsNullOrWhiteSpace($ReferencePdf)) { $null } else { Resolve-WorkflowPath $ReferencePdf }
$referenceUsed = $false
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
    ConfigEnvFile = Get-WorkflowFileReceipt -PathValue $envFilePath
}

$workflowOptions = [ordered]@{
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
    workflowReviewScale = $WorkflowReviewScale
    visualAuditScale = $VisualAuditScale
    blindFocusRegionsFile = $blindFocusRegionsPath
    visualAuditFocusRegionsFile = $visualAuditFocusRegionsPath
    skipVisualAudit = [bool]$SkipVisualAudit
    keepReview = [bool]$KeepReview
    useGatewayProxy = [bool]$UseGatewayProxy
    allowCloudEgress = [bool]$AllowCloudEgress
    configEnvFile = $envFilePath
}
$workflowOptionsJson = $workflowOptions | ConvertTo-Json -Compress -Depth 10
$workflowOptionsFingerprint = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($workflowOptionsJson)))
$workflowOptionsFingerprint = $workflowOptionsFingerprint.ToLowerInvariant()

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
    BlindEvidence = $blindEvidencePath
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
    Assert-ResumeBlindGeneration `
        -ReceiptPath $resumeWorkflowReceiptPath `
        -CurrentInputs $workflowInputReceipts `
        -CurrentOptions $workflowOptions `
        -CurrentOptionsFingerprint $workflowOptionsFingerprint
}
else {
    $null
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

# Hold an OS-owned lock before clearing receipts or quarantining prior finals.
# Concurrent runs for the same exam must not destroy one another's artifacts;
# the OS releases the lease even if the process crashes.
$workflowLockPath = Join-Path $outputRoot ".${baseName}.workflow.lock"
try {
    $workflowLock = [IO.FileStream]::new($workflowLockPath, [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 1, [IO.FileOptions]::DeleteOnClose)
}
catch {
    throw "Another workflow is using this exam output, or the output lock is unavailable: $workflowLockPath"
}

try {
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

foreach ($summaryPath in @($blindSummaryPath, $semanticFindingsSummaryPath, $semanticMergeSummaryPath, $visualFindingsSummaryPath, $visualMergeSummaryPath, $referenceReviewSummaryPath, $blindEvidencePath, $semanticReviewEvidencePath, $referenceReviewEvidencePath, $workflowReceiptPath)) {
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
                $blindEvidencePath,
                $semanticReviewMarkdownPath,
                $semanticReviewReportPath,
                $semanticReviewEvidencePath,
                $(if (-not $SkipVisualAudit) { $visualAuditFindingsPath; $visualAuditMarkdownPath; $visualAuditReportPath }),
                $(if ($referencePath) { $comparisonReportPath; $referenceReviewEvidencePath })
            )) {
            $artifactReceipt = Get-WorkflowFileReceipt -PathValue $artifactPath
            if ($null -ne $artifactReceipt) {
                $artifacts += $artifactReceipt
            }
        }
    }

    # The receipt mirrors $workflowOptions field-for-field; deriving it here
    # keeps a new workflow option a single-place edit instead of two.
    $receiptOptions = [ordered]@{}
    foreach ($optionName in $workflowOptions.Keys) {
        $receiptOptions[$optionName] = $workflowOptions[$optionName]
    }
    $receiptOptions.optionsFingerprint = $workflowOptionsFingerprint

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
            configEnv = $workflowInputReceipts.ConfigEnvFile
        }
        options = $receiptOptions
        phases = $phaseReceipts
        artifacts = $artifacts
        reviewEvidence = $(if ($Status -eq "succeeded") {
                Get-WorkflowReviewEvidence -AnswerMarkdownPath $answerMarkdownPath
            }
            else {
                $null
            })
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
    # receipt instead of leaving an unvalidatable file behind. Routed through
    # Invoke-NodeTool so the packaged bundled-Node resolution applies here too.
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/rule-compiler/validate-workflow-receipt.mjs") -Arguments @(
        "--receipt", $workflowReceiptPath
    )
}

if ($UseGatewayProxy) {
    $configuredProxy = @($env:HTTPS_PROXY, $env:HTTP_PROXY, $env:ALL_PROXY) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1
    if (-not $configuredProxy) {
        throw "-UseGatewayProxy requires HTTPS_PROXY, HTTP_PROXY, or ALL_PROXY."
    }

    $nodeHelp = (& $workflowNodeExecutable --help 2>&1 | Out-String)
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
        [string]$CandidateBaselineFile,
        [string]$SemanticFindingsFile,
        [string]$AuditImagesDir,
        [string]$AuditFindingsFile,
        [string]$ReferenceImagesDir,
        [string]$ReferenceTextFile,
        [string]$ReferencePdfFile,
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
        "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture)
    )
    if ($AllowCloudEgress) {
        $arguments += "--allow-cloud-egress"
    }
    if ($IncludeVisualDetail) {
        $arguments += @("--visual-detail", $VisualDetail)
    }
    if ($ImagesDir) {
        $arguments += @("--images-dir", $ImagesDir)
    }
    if ($CandidateFile) {
        $arguments += @("--candidate-file", $CandidateFile)
    }
    if ($CandidateBaselineFile) {
        $arguments += @("--candidate-baseline-file", $CandidateBaselineFile)
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
    if ($ReferencePdfFile) {
        $arguments += @("--reference-pdf-file", $ReferencePdfFile)
    }
    return $arguments
}

try {
    if (-not $AllowCloudEgress) {
        throw "Live AI requests require explicit -AllowCloudEgress and CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true in the selected config file."
    }

    $configEgressValue = Get-Content -LiteralPath $envFilePath |
        Where-Object { $_ -match '^\s*(?:export\s+)?CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED\s*=\s*(?<value>.*?)\s*$' } |
        Select-Object -Last 1
    if ($configEgressValue) {
        $configEgressValue = $configEgressValue -replace '^\s*(?:export\s+)?CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED\s*=\s*', ''
        $configEgressValue = $configEgressValue.Trim()
        if (-not (($configEgressValue.StartsWith('"') -and $configEgressValue.EndsWith('"')) -or
                ($configEgressValue.StartsWith("'") -and $configEgressValue.EndsWith("'")))) {
            $configEgressValue = $configEgressValue -replace '\s+#.*$', ''
        }
        $configEgressValue = $configEgressValue.Trim().Trim('"').Trim("'")
    }
    if ($configEgressValue -notin @("1", "true", "yes", "on")) {
        throw "Live request blocked. Set CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true in the selected config file; this cannot be supplied by an inherited process variable."
    }

    # Set the process value from the verified config, so a parent's value cannot
    # override its false state. The finally block restores the parent value.
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

    Invoke-WorkflowPhase -Name "blindGeneration" `
        -ExecuteMessage "[live-answer-workflow] generate answer Markdown from $($pageImages.Count) page(s)" `
        -ResumeMessage "[live-answer-workflow] resume hash-bound blind candidate without repeating generation" `
        -SummaryPath $blindSummaryPath `
        -ArtifactPath $generationOutputPath `
        -Execute {
            $blindArguments = New-AnswerRequestArguments `
                -OutputPath $generationOutputPath `
                -SummaryPath $blindSummaryPath `
                -QualityProfile $BlindQualityProfile `
                -ImagesDir $pageDirectory `
                -IncludeVisualDetail `
                -IncludeSourceText
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $blindArguments
        }

    Invoke-WorkflowPhase -Name "semanticFindings" `
        -ExecuteMessage "[live-answer-workflow] independently re-solve semantic questions without the reference answer" `
        -ResumeMessage "[live-answer-workflow] resume hash-bound semantic findings without repeating review" `
        -SummaryPath $semanticFindingsSummaryPath `
        -ArtifactPath $semanticFindingsPath `
        -Execute {
            $semanticFindingsArguments = New-AnswerRequestArguments `
                -OutputPath $semanticFindingsPath `
                -SummaryPath $semanticFindingsSummaryPath `
                -QualityProfile $SemanticQualityProfile `
                -ImagesDir $pageDirectory `
                -CandidateFile $blindMarkdownPath `
                -CandidateBaselineFile $blindMarkdownPath `
                -SemanticFindingsOnly `
                -IncludeVisualDetail `
                -IncludeSourceText
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $semanticFindingsArguments
        }

    Copy-WorkflowFileAtomic -SourcePath $semanticFindingsPath -DestinationPath $blindEvidencePath
    Invoke-WorkflowPhase -Name "semanticMerge" `
        -ExecuteMessage "[live-answer-workflow] merge only independently confirmed semantic findings" `
        -ResumeMessage "[live-answer-workflow] resume hash-bound semantic merge without repeating review" `
        -SummaryPath $semanticMergeSummaryPath `
        -ArtifactPath $semanticReviewMarkdownPath `
        -Execute {
            $semanticMergeArguments = New-AnswerRequestArguments `
                -OutputPath $semanticReviewMarkdownPath `
                -SummaryPath $semanticMergeSummaryPath `
                -QualityProfile $SemanticQualityProfile `
                -ImagesDir $pageDirectory `
                -CandidateFile $blindMarkdownPath `
                -CandidateBaselineFile $blindEvidencePath `
                -SemanticFindingsFile $semanticFindingsPath `
                -IncludeSourceText
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $semanticMergeArguments
        }
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
        $blindMarkdownPath,
        $semanticReviewMarkdownPath,
        $semanticReviewReportPath,
        "--semantic-findings", $blindEvidencePath,
        "--evidence-out", $semanticReviewEvidencePath
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

        Invoke-WorkflowPhase -Name "visualFindings" `
            -ExecuteMessage "[live-answer-workflow] extract visual findings without rewriting the blind candidate" `
            -ResumeMessage "[live-answer-workflow] resume hash-bound visual findings without repeating audit" `
            -SummaryPath $visualFindingsSummaryPath `
            -ArtifactPath $visualAuditFindingsPath `
            -Execute {
                $visualFindingsArguments = New-AnswerRequestArguments `
                    -OutputPath $visualAuditFindingsPath `
                    -SummaryPath $visualFindingsSummaryPath `
                    -QualityProfile $VisualQualityProfile `
                    -CandidateFile $candidateForVisual `
                    -CandidateBaselineFile $candidateForVisual `
                    -AuditImagesDir $visualAuditPageDirectory `
                    -AuditFindingsOnly `
                    -IncludeVisualDetail
                Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $visualFindingsArguments
            }
        Invoke-WorkflowPhase -Name "visualMerge" `
            -ExecuteMessage "[live-answer-workflow] merge visual findings into the complete answer Markdown" `
            -ResumeMessage "[live-answer-workflow] resume hash-bound visual merge without repeating audit" `
            -SummaryPath $visualMergeSummaryPath `
            -ArtifactPath $visualAuditMarkdownPath `
            -Execute {
                $visualMergeArguments = New-AnswerRequestArguments `
                    -OutputPath $visualAuditMarkdownPath `
                    -SummaryPath $visualMergeSummaryPath `
                    -QualityProfile $VisualQualityProfile `
                    -CandidateFile $candidateForVisual `
                    -CandidateBaselineFile $semanticReviewMarkdownPath `
                    -AuditFindingsFile $visualAuditFindingsPath
                Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $visualMergeArguments
            }
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $candidateForVisual,
            $visualAuditMarkdownPath,
            $visualAuditReportPath,
            "--semantic-evidence", $semanticReviewEvidencePath,
            "--visual-findings", $visualAuditFindingsPath,
            "--evidence-out", $semanticReviewEvidencePath
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
        $referenceUsed = $true

        Invoke-WorkflowPhase -Name "referenceReview" `
            -ExecuteMessage "[live-answer-workflow] review blind candidate against authoritative reference" `
            -ResumeMessage "[live-answer-workflow] resume hash-bound reference review without repeating comparison" `
            -SummaryPath $referenceReviewSummaryPath `
            -ArtifactPath $answerMarkdownPath `
            -Execute {
                $reviewArguments = New-AnswerRequestArguments `
                    -OutputPath $answerMarkdownPath `
                    -SummaryPath $referenceReviewSummaryPath `
                    -QualityProfile $ReferenceQualityProfile `
                    -ImagesDir $pageDirectory `
                    -CandidateFile $candidateForReference `
                    -CandidateBaselineFile $candidateForReference `
                    -ReferenceImagesDir $referencePageDirectory `
                    -ReferenceTextFile $referenceTextPath `
                    -ReferencePdfFile $referencePath `
                    -IncludeVisualDetail `
                    -IncludeSourceText
                Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $reviewArguments
            }
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $candidateForReference,
            $answerMarkdownPath,
            $comparisonReportPath,
            "--semantic-evidence", $semanticReviewEvidencePath,
                "--reference-evidence", $referencePath,
            "--evidence-out", $referenceReviewEvidencePath
        )
    }

    Invoke-WorkflowPhase -Name "delivery" `
        -ExecuteMessage "[live-answer-workflow] validate and render answer delivery" `
        -ArtifactPath $answerPdfPath `
        -Execute {
            $deliveryArguments = @(
                $answerMarkdownPath,
                $answerPdfPath,
                "--subject-pack", $SubjectPack,
                "--profile", $Profile,
                "--review-scale", $WorkflowReviewScale.ToString([Globalization.CultureInfo]::InvariantCulture)
            )
            if ($KeepReview) {
                $deliveryArguments += "--keep-review"
            }
            Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/latex-renderer/deliver-answer.mjs") -Arguments $deliveryArguments
        }

    if ($SkipVisualAudit) {
        foreach ($stalePath in @($visualAuditMarkdownPath, $visualAuditFindingsPath, $visualAuditReportPath)) {
            Remove-Item -LiteralPath $stalePath -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not $referencePath) {
        Remove-Item -LiteralPath $comparisonReportPath -Force -ErrorAction SilentlyContinue
    }
    Assert-NoWorkflowManifestReferenceLeak -Outputs @{
        DeliveryManifest = $deliveryManifestPath
        DeliveryReviewManifest = (Join-Path $deliveryReviewDirectory "manifest.json")
    }
    Assert-NoWorkflowManifestConfigReference -Outputs @{
        DeliveryManifest = $deliveryManifestPath
        DeliveryReviewManifest = (Join-Path $deliveryReviewDirectory "manifest.json")
    }
    Assert-WorkflowInputsUnchanged -InputReceipts $workflowInputReceipts
    Write-WorkflowReceipt -Status "succeeded"
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/rule-compiler/validate-workflow-receipt.mjs") -Arguments @(
        "--receipt", $workflowReceiptPath
    )

    $workflowSucceeded = $true
    Write-Host "[live-answer-workflow] complete"
    Write-Host "Markdown: $answerMarkdownPath"
    Write-Host "Blind candidate: $blindMarkdownPath"
    Write-Host "Workflow review evidence: $semanticReviewEvidencePath"
    if ($referencePath) {
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
    # The workflow process owns this change and ends immediately. Restoring the
    # inherited override here is useful for command-hosted invocation.
    if ($processEgressWasSet) {
        $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = $previousEgressValue
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
}
finally {
    $workflowLock.Dispose()
}
