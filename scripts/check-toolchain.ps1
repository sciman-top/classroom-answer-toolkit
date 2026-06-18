$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

Write-Host "rule snapshots:"
Assert-CommandSuccess { npm --prefix tools/rule-compiler run compile:snapshot -- --profile classroom --out .snapshot-cache/resolved-snapshot.json } "Classroom snapshot compilation failed."
Assert-CommandSuccess { npm --prefix tools/rule-compiler run compile:snapshot -- --profile compact --out .snapshot-cache/resolved-snapshot.compact.json } "Compact snapshot compilation failed."

Write-Host "latex renderer smoke:"
Assert-CommandSuccess { npm --prefix tools/latex-renderer run smoke } "LaTeX renderer smoke failed."

Write-Host "answer graphics smoke:"
Assert-CommandSuccess { npm --prefix tools/answer-graphics run smoke } "Answer graphics smoke failed."

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
