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

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
$answerMarkdownPath = Join-Path $outputRoot "${baseName}参考答案.md"
$blindMarkdownPath = Join-Path $outputRoot "${baseName}盲答候选.md"
$answerPdfPath = Join-Path $outputRoot "${baseName}参考答案.pdf"
$comparisonReportPath = Join-Path $outputRoot "${baseName}答案自动复核文本差异报告.md"
$workRoot = Join-Path $env:TEMP ("classroom-answer-toolkit\live-answer-workflow\" + [Guid]::NewGuid().ToString("N"))
$pageDirectory = Join-Path $workRoot "pages"
$referencePageDirectory = Join-Path $workRoot "reference-pages"
$referenceTextPath = Join-Path $workRoot "reference-answer-text.txt"
$workflowSucceeded = $false
$previousCloudEgress = $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
$referencePath = if ([string]::IsNullOrWhiteSpace($ReferencePdf)) { $null } else { Resolve-WorkflowPath $ReferencePdf }

if ($referencePath -and -not (Test-Path -LiteralPath $referencePath -PathType Leaf)) {
    throw "Reference PDF not found: $referencePath"
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

    Write-Host "[live-answer-workflow] generate answer Markdown from $($pageImages.Count) page(s)"
    $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
    $generationOutputPath = if ($referencePath) { $blindMarkdownPath } else { $answerMarkdownPath }
    Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments @(
        "--config-env-file", $envFilePath,
        "--prompt-file", $promptPath,
        "--images-dir", $pageDirectory,
        "--output", $generationOutputPath,
        "--provider", $Provider,
        "--visual-detail", $VisualDetail,
        "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--allow-cloud-egress"
    )

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
        $reviewArguments = @(
            "--config-env-file", $envFilePath,
            "--prompt-file", $promptPath,
            "--images-dir", $pageDirectory,
            "--candidate-file", $blindMarkdownPath,
            "--reference-images-dir", $referencePageDirectory,
            "--output", $answerMarkdownPath,
            "--provider", $Provider,
            "--visual-detail", $VisualDetail,
            "--max-output-tokens", $MaxOutputTokens.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--timeout-ms", $TimeoutMs.ToString([Globalization.CultureInfo]::InvariantCulture),
            "--allow-cloud-egress"
        )
        if (Test-Path -LiteralPath $referenceTextPath -PathType Leaf) {
            $reviewArguments += @("--reference-text-file", $referenceTextPath)
        }
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-request.mjs") -Arguments $reviewArguments
        Invoke-NodeTool -ScriptPath (Join-Path $repoRoot "tools/ai-gateway/answer-diff-report.mjs") -Arguments @(
            $blindMarkdownPath,
            $answerMarkdownPath,
            $comparisonReportPath
        )
    }

    Write-Host "[live-answer-workflow] validate and render answer delivery"
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

    $workflowSucceeded = $true
    Write-Host "[live-answer-workflow] complete"
    Write-Host "Markdown: $answerMarkdownPath"
    if ($referencePath) {
        Write-Host "Blind candidate: $blindMarkdownPath"
        Write-Host "Comparison report: $comparisonReportPath"
    }
    Write-Host "PDF: $answerPdfPath"
}
finally {
    if ($null -eq $previousCloudEgress) {
        Remove-Item Env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED -ErrorAction SilentlyContinue
    }
    else {
        $env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = $previousCloudEgress
    }

    if ($workflowSucceeded -and (Test-Path -LiteralPath $workRoot)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
    elseif (Test-Path -LiteralPath $workRoot) {
        Write-Warning "Workflow failed; retained diagnostics: $workRoot"
    }
}
