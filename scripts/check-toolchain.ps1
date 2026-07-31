$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "subject-pack-tooling.ps1")

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Assert-CommandSuccess {
    param([scriptblock]$Block, [string]$Message)
    & $Block
    if ($LASTEXITCODE -ne 0) { throw $Message }
}

Write-Host "runtime prerequisites:"
Assert-CommandSuccess { dotnet --list-sdks } "dotnet SDK check failed."
Assert-CommandSuccess { node --version } "Node.js check failed."
Assert-CommandSuccess { npm --version } "npm check failed."

$browserCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Chromium\Application\chrome.exe"),
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
if (-not ($browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)) {
    throw "No local Chromium, Chrome, or Edge executable found."
}

Write-Host "core assets:"
Assert-CommandSuccess { npm --prefix tools/rule-compiler run validate:assets } "Core asset validation failed."

Write-Host "AI answer request contract:"
Assert-CommandSuccess {
    npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets
} "AI gateway config validation failed."
Assert-CommandSuccess { npm --prefix tools/ai-gateway run test:answer } "AI answer request tests failed."

Write-Host "renderer Unicode path contract:"
Assert-CommandSuccess { npm --prefix tools/latex-renderer run test:output-path } "Renderer output path tests failed."
Assert-CommandSuccess { npm --prefix tools/latex-renderer run test:render } "Renderer math rendering tests failed."

$subjectPacks = Get-SubjectPackMetadata -RepositoryRoot $repoRoot
if ($subjectPacks.Count -eq 0) { throw "No subject pack manifests were found under prompts/." }

Write-Host "rule snapshots:"
foreach ($subjectPack in $subjectPacks) {
    foreach ($profile in $subjectPack.Profiles) {
        $outputPath = Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile
        $relativeOutputPath = Get-RelativePath -BasePath $repoRoot -TargetPath $outputPath
        Assert-CommandSuccess {
            & npm --prefix tools/rule-compiler run compile:snapshot -- --subject-pack $subjectPack.AssetId --profile $profile --out $relativeOutputPath
        } ("Snapshot compilation failed for {0}/{1}." -f $subjectPack.AssetId, $profile)
    }
}

Write-Host "cross-subject snapshot contract:"
Assert-CommandSuccess { npm --prefix tools/rule-compiler run validate:cross-subject } "Cross-subject validation failed."

Write-Host "Markdown/PDF delivery smoke:"
Assert-CommandSuccess { npm --prefix tools/latex-renderer run smoke } "Renderer smoke failed."

Write-Host "answer layout eval:"
foreach ($subjectPack in $subjectPacks) {
    if (-not (Test-Path -LiteralPath $subjectPack.EvalDatasetPath)) {
        throw ("Eval dataset not found for {0}: {1}" -f $subjectPack.AssetId, $subjectPack.EvalDatasetPath)
    }
    Assert-CommandSuccess {
        & node tools/latex-renderer/eval-answer-fixtures.mjs --subject-pack $subjectPack.AssetId
    } ("Answer eval failed for {0}." -f $subjectPack.AssetId)
}

Write-Host "Answer generation and layout toolchain check complete."
