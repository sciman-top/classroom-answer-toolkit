$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "subject-pack-tooling.ps1")

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Assert-CommandSuccess {
    param(
        [scriptblock]$Block,
        [string]$Message
    )

    & $Block
    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

Write-Host "dotnet SDKs:"
Assert-CommandSuccess { dotnet --list-sdks } "dotnet --list-sdks failed."

Write-Host "node:"
Assert-CommandSuccess { node --version } "node --version failed."

Write-Host "npm:"
Assert-CommandSuccess { npm --version } "npm --version failed."

Write-Host "python:"
Assert-CommandSuccess { python --version } "python --version failed."

$browserCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Chromium\Application\chrome.exe"),
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

$browserPath = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browserPath) {
    throw "No local Chromium, Chrome, or Edge executable found."
}

Write-Host "browser: $browserPath"

Write-Host "rule compiler assets:"
Assert-CommandSuccess { npm --prefix tools/rule-compiler run validate:assets } "Rule compiler asset validation failed."

$subjectPacks = Get-SubjectPackMetadata -RepositoryRoot $repoRoot
if ($subjectPacks.Count -eq 0) {
    throw "No subject pack manifests were found under prompts/."
}

Write-Host "rule snapshots:"
foreach ($subjectPack in $subjectPacks) {
    foreach ($profile in $subjectPack.Profiles) {
        $outputPath = Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile
        $relativeOutputPath = Get-RelativePath -BasePath $repoRoot -TargetPath $outputPath
        Write-Host ("- {0}/{1} -> {2}" -f $subjectPack.AssetId, $profile, $relativeOutputPath)
        Assert-CommandSuccess {
            & npm --prefix tools/rule-compiler run compile:snapshot -- --subject-pack $subjectPack.AssetId --profile $profile --out $relativeOutputPath
        } ("Snapshot compilation failed for {0}/{1}." -f $subjectPack.AssetId, $profile)
    }
}

Write-Host "cross-subject contract:"
Assert-CommandSuccess { npm --prefix tools/rule-compiler run validate:cross-subject } "Cross-subject validation failed."

Write-Host "latex renderer smoke:"
Assert-CommandSuccess { npm --prefix tools/latex-renderer run smoke } "LaTeX renderer smoke failed."

Write-Host "physics answer eval:"
foreach ($subjectPack in $subjectPacks) {
    if (-not (Test-Path -LiteralPath $subjectPack.EvalDatasetPath)) {
        throw ("Eval dataset not found for subject pack {0}: {1}" -f $subjectPack.AssetId, $subjectPack.EvalDatasetPath)
    }

    Write-Host ("{0} answer eval:" -f $subjectPack.AssetId)
    Assert-CommandSuccess {
        & node tools/latex-renderer/eval-answer-fixtures.mjs --subject-pack $subjectPack.AssetId
    } ("{0} answer eval failed." -f $subjectPack.AssetId)
}

Write-Host "answer graphics smoke: skipped (experimental, not part of default toolchain gate)"

$venvPython = Join-Path $repoRoot "tools\ocr\.venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    Write-Host "ocr venv imports:"
    Assert-CommandSuccess {
        & $venvPython -c "import cv2; import PIL; import rapidocr_onnxruntime; print('ocr imports ok')"
    } "OCR virtual environment import check failed."
} else {
    Write-Host "ocr venv not found; skip import check."
}

Write-Host "Toolchain check complete."
