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

Write-Host "ai gateway config template:"
Assert-CommandSuccess {
    npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets
} "AI gateway config template validation failed."

Write-Host "ai gateway vision contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/ai-gateway run test:vision
} "AI gateway vision contract tests failed."

Write-Host "visual evidence decision contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-evidence run test:decision
} "Visual evidence decision contract tests failed."

Write-Host "visual risk diagnostic contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-evidence run test:visual-risk
} "Visual risk diagnostic contract tests failed."

Write-Host "visual preprocessing contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-preprocessor test
} "Visual preprocessing contract tests failed."

Write-Host "visual preprocessing canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-preprocessor run validate:fixtures
} "Visual preprocessing canonical fixture validation failed."

Write-Host "visual structure extraction contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-structure-extractor test
} "Visual structure extraction contract tests failed."

Write-Host "visual structure extraction canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-structure-extractor run validate:fixtures
} "Visual structure extraction canonical fixture validation failed."

Write-Host "visual OCR observation contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-observer test
} "Visual OCR observation contract tests failed."

Write-Host "visual OCR observation canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-observer run validate:fixtures
} "Visual OCR observation canonical fixture validation failed."

Write-Host "visual spatial observation contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-spatial-observer test
} "Visual spatial observation contract tests failed."

Write-Host "visual spatial observation canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-spatial-observer run validate:fixtures
} "Visual spatial observation canonical fixture validation failed."

Write-Host "visual OCR-region association contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-region-association test
} "Visual OCR-region association contract tests failed."

Write-Host "visual OCR-region association canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-region-association run validate:fixtures
} "Visual OCR-region association canonical fixture validation failed."

Write-Host "visual OCR diagnostic contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-diagnostics test
} "Visual OCR diagnostic contract tests failed."

Write-Host "visual OCR diagnostic canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-ocr-diagnostics run validate:fixtures
} "Visual OCR diagnostic canonical fixture validation failed."

Write-Host "visual text-region diagnostic contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-text-region-diagnostics test
} "Visual text-region diagnostic contract tests failed."

Write-Host "visual text-region diagnostic canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-text-region-diagnostics run validate:fixtures
} "Visual text-region diagnostic canonical fixture validation failed."

Write-Host "visual semantic projection contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-semantic-projector test
} "Visual semantic projection contract tests failed."

Write-Host "visual semantic projection canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-semantic-projector run validate:fixtures
} "Visual semantic projection canonical fixture validation failed."

Write-Host "synthetic OCR layout solver contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/ocr-layout-solver test
} "Synthetic OCR layout solver contract tests failed."

Write-Host "synthetic OCR layout solver canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/ocr-layout-solver run validate:fixtures
} "Synthetic OCR layout solver canonical fixture validation failed."

Write-Host "synthetic Track C validator contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/synthetic-track-validator test
} "Synthetic Track C validator contract tests failed."

Write-Host "synthetic Track C validator canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/synthetic-track-validator run validate:fixtures
} "Synthetic Track C validator canonical fixture validation failed."

Write-Host "synthetic Track A/B/C orchestration contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/track-orchestrator test
} "Synthetic Track A/B/C orchestration contract tests failed."

Write-Host "synthetic Track A/B/C orchestration canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/track-orchestrator run validate:fixtures
} "Synthetic Track A/B/C orchestration canonical fixture validation failed."

Write-Host "visual machine review contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-machine-review test
} "Visual machine review contract tests failed."

Write-Host "visual machine review canonical fixtures:"
Assert-CommandSuccess {
    npm --prefix tools/visual-machine-review run validate:fixtures
} "Visual machine review canonical fixture validation failed."

Write-Host "visual evidence delivery aggregate contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/visual-evidence run test:aggregate
} "Visual evidence delivery aggregate contract tests failed."

Write-Host "review queue projection contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/review-queue test
} "Review queue projection contract tests failed."

Write-Host "sample flywheel admission and run-record contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/sample-flywheel test
} "Sample flywheel contract tests failed."

Write-Host "synthetic answer generation contract tests:"
Assert-CommandSuccess {
    npm --prefix tools/answer-generator test
} "Synthetic answer generation contract tests failed."

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
