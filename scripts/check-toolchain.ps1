param(
    [ValidateSet("Core", "Full")]
    [string]$Mode = "Core",
    [string]$SubjectPack = "junior-physics-answer"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "subject-pack-tooling.ps1")

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot
$totalStopwatch = [Diagnostics.Stopwatch]::StartNew()
$executedSteps = [Collections.Generic.List[string]]::new()

function Invoke-GateStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Block,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $stepStopwatch = [Diagnostics.Stopwatch]::StartNew()
    Write-Host ("[{0}] {1}" -f $Mode, $Name)
    & $Block
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
    $stepStopwatch.Stop()
    $executedSteps.Add(("{0} ({1:N2}s)" -f $Name, $stepStopwatch.Elapsed.TotalSeconds))
}

Write-Host ("Toolchain gate mode={0}; requestedSubjectPack={1}" -f $Mode, $SubjectPack)

Invoke-GateStep "assets" {
    npm --prefix tools/rule-compiler run validate:assets
} "Asset validation failed."

$subjectPacks = @(Get-SubjectPackMetadata -RepositoryRoot $repoRoot)
if ($subjectPacks.Count -eq 0) {
    throw "No subject pack manifests were found under prompts/."
}

$selectedSubjectPacks = if ($Mode -eq "Full") {
    $subjectPacks
} else {
    @($subjectPacks | Where-Object { $_.AssetId -eq $SubjectPack })
}
if ($selectedSubjectPacks.Count -eq 0) {
    throw ("Unknown subject pack: {0}" -f $SubjectPack)
}

foreach ($selectedSubjectPack in $selectedSubjectPacks) {
    foreach ($profile in $selectedSubjectPack.Profiles) {
        $outputPath = Get-SubjectPackSnapshotOutputPath -SubjectPack $selectedSubjectPack -Profile $profile
        $relativeOutputPath = Get-RelativePath -BasePath $repoRoot -TargetPath $outputPath
        Invoke-GateStep ("snapshot:{0}/{1}" -f $selectedSubjectPack.AssetId, $profile) {
            & npm --prefix tools/rule-compiler run compile:snapshot -- --subject-pack $selectedSubjectPack.AssetId --profile $profile --out $relativeOutputPath
        } ("Snapshot compilation failed for {0}/{1}." -f $selectedSubjectPack.AssetId, $profile)
    }
}

if ($Mode -eq "Full") {
    Invoke-GateStep "cross-subject" {
        npm --prefix tools/rule-compiler run validate:cross-subject
    } "Cross-subject validation failed."
    Invoke-GateStep "delivery-contract" {
        npm --prefix tools/latex-renderer run test:delivery-contract
    } "Delivery manifest contract tests failed."

    foreach ($selectedSubjectPack in $selectedSubjectPacks) {
        if (-not (Test-Path -LiteralPath $selectedSubjectPack.EvalDatasetPath)) {
            throw ("Eval dataset not found for {0}: {1}" -f $selectedSubjectPack.AssetId, $selectedSubjectPack.EvalDatasetPath)
        }
        Invoke-GateStep ("answer-eval:{0}" -f $selectedSubjectPack.AssetId) {
            & node tools/latex-renderer/eval-answer-fixtures.mjs --subject-pack $selectedSubjectPack.AssetId
        } ("Answer eval failed for {0}." -f $selectedSubjectPack.AssetId)
    }
}

$totalStopwatch.Stop()
Write-Host "Toolchain gate summary:"
Write-Host ("- mode: {0}" -f $Mode)
Write-Host ("- subject pack: {0}" -f $(if ($Mode -eq "Full") { "all" } else { $SubjectPack }))
Write-Host ("- executed: {0}" -f ($executedSteps -join "; "))
Write-Host ("- elapsed: {0:N2}s" -f $totalStopwatch.Elapsed.TotalSeconds)
Write-Host "Answer generation and layout toolchain check complete."
