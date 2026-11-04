#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[1-9]\d*$')][string]$CandidateRunId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$GitHubActor,
    [Parameter(Mandatory = $true)][DateTimeOffset]$CandidateCompletedAt,
    [Parameter(Mandatory = $true)][string]$AcceptanceRecordPath,
    [string]$DeliveryRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$versionRoot = if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) {
    Join-Path $repoRoot "artifacts/deliveries/$Version"
}
else {
    [IO.Path]::GetFullPath($DeliveryRoot)
}
$installerPath = Join-Path $versionRoot "installer/stable/ClassroomToolkit-$Version-setup.exe"
$portablePath = Join-Path $versionRoot "portable/ClassroomToolkit-$Version-portable-win-x64.zip"
$installManifestPath = Join-Path $versionRoot "installer/stable/install-manifest.json"

foreach ($path in @($installerPath, $portablePath, $installManifestPath, $AcceptanceRecordPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Release acceptance input is missing: $path"
    }
}

if ($CandidateRunId -notmatch '^[1-9]\d*$') {
    throw "Candidate run id must be a positive decimal GitHub Actions run id."
}
if ($GitHubActor -notmatch '^[A-Za-z0-9-]{1,39}$') {
    throw "GitHub actor is not a valid account identifier."
}

$installManifest = Get-Content -LiteralPath $installManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$installManifest.schemaVersion -ne "1.0" -or
    [string]$installManifest.kind -ne "classroom-toolkit-install-manifest" -or
    [string]$installManifest.version -ne $Version -or
    -not [string]::Equals([string]$installManifest.sourceCommit, $SourceCommit, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Candidate install manifest does not match the requested version and source commit."
}

$packageFacts = @(
    [ordered]@{ kind = "installer"; path = "installer/stable/ClassroomToolkit-$Version-setup.exe"; file = $installerPath },
    [ordered]@{ kind = "portable"; path = "portable/ClassroomToolkit-$Version-portable-win-x64.zip"; file = $portablePath }
)
foreach ($package in $packageFacts) {
    $manifestAssets = @($installManifest.assets | Where-Object { [string]$_.kind -eq $package.kind })
    if ($manifestAssets.Count -ne 1) {
        throw "Candidate install manifest must contain exactly one $($package.kind) asset."
    }
    $actualBytes = (Get-Item -LiteralPath $package.file).Length
    $actualHash = Get-FileSha256 -PathValue $package.file
    if ([string]$manifestAssets[0].name -ne [IO.Path]::GetFileName($package.file) -or
        [long]$manifestAssets[0].bytes -ne $actualBytes -or
        -not [string]::Equals([string]$manifestAssets[0].sha256, $actualHash, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate $($package.kind) package does not match its install manifest."
    }
    $package["bytes"] = $actualBytes
    $package["sha256"] = $actualHash
}

try {
    $recordJson = Get-Content -LiteralPath $AcceptanceRecordPath -Raw -Encoding utf8
    $record = $recordJson | ConvertFrom-Json
}
catch {
    throw "Representative acceptance record is not valid JSON: $($_.Exception.Message)"
}
$recordSchemaPath = Join-Path $PSScriptRoot "verify-release-acceptance.schema.json"
$recordSchemaErrors = @(& node (Join-Path $PSScriptRoot "../tools/rule-compiler/validate-json.mjs") --schema $recordSchemaPath --value $AcceptanceRecordPath 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "Representative acceptance record failed schema validation: $($recordSchemaErrors -join [Environment]::NewLine)"
}
if ([string]$record.schemaVersion -ne "1.0" -or
    [string]$record.kind -ne "classroom-toolkit-representative-acceptance-input" -or
    [string]$record.status -ne "accepted" -or
    [string]$record.version -ne $Version) {
    throw "Representative acceptance record must be accepted for version $Version."
}
if (-not [string]::Equals([string]$record.sourceCommit, $SourceCommit, [StringComparison]::OrdinalIgnoreCase) -or
    [string]$record.candidateRunId -ne $CandidateRunId) {
    throw "Representative acceptance record does not bind the selected candidate run and source commit."
}
if ([string]$record.tester.role -ne "representative-non-developer" -or
    [string]::IsNullOrWhiteSpace([string]$record.tester.identifier) -or
    ([string]$record.tester.identifier).Length -gt 80 -or
    [string]$record.tester.identifier -match '[\x00-\x1F\x7F]') {
    throw "Representative acceptance record must identify a representative non-developer tester."
}
if ([string]$record.confirmedByReleaseOwner -ne $GitHubActor) {
    throw "Representative acceptance must be explicitly confirmed by the submitting release owner."
}
if ([string]::IsNullOrWhiteSpace([string]$record.evidenceReference)) {
    throw "Representative acceptance must reference the retained manual test evidence for the exact candidate."
}
$allowedRecordFields = @(
    "schemaVersion", "kind", "status", "version", "sourceCommit", "candidateRunId",
    "acceptedAt", "tester", "assets", "scenarios", "confirmedByReleaseOwner", "acknowledgement",
    "evidenceReference"
)
foreach ($property in $record.PSObject.Properties.Name) {
    if ($property -notin $allowedRecordFields) {
        throw "Representative acceptance record contains an unknown field: $property"
    }
}
foreach ($property in $record.tester.PSObject.Properties.Name) {
    if ($property -notin @("identifier", "role")) {
        throw "Representative acceptance tester contains an unknown field: $property"
    }
}
foreach ($property in $record.assets.PSObject.Properties.Name) {
    if ($property -notin @("installerSha256", "portableSha256")) {
        throw "Representative acceptance assets contains an unknown field: $property"
    }
}
if ([string]$record.acknowledgement -ne "I confirm the representative tester performed the recorded real-world checks on these exact package hashes.") {
    throw "Representative acceptance acknowledgement is missing or does not match the required statement."
}

$timestampDocument = [System.Text.Json.JsonDocument]::Parse($recordJson)
try {
    $acceptedAtText = $timestampDocument.RootElement.GetProperty("acceptedAt").GetString()
}
finally {
    $timestampDocument.Dispose()
}
if ($acceptedAtText -notmatch '(?:Z|[+-]\d{2}:\d{2})$') {
    throw "Representative acceptance timestamp must include a UTC marker or numeric offset."
}
try {
    $acceptedAt = [DateTimeOffset]::Parse($acceptedAtText, [Globalization.CultureInfo]::InvariantCulture)
}
catch {
    throw "Representative acceptance timestamp is invalid: $acceptedAtText"
}
if ($acceptedAt -lt $CandidateCompletedAt -or $acceptedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
    throw "Representative acceptance must occur after the candidate completed and cannot be in the future."
}

foreach ($package in $packageFacts) {
    $hashProperty = if ($package.kind -eq "installer") { "installerSha256" } else { "portableSha256" }
    if (-not [string]::Equals([string]$record.assets.$hashProperty, $package.sha256, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Representative acceptance $($package.kind) hash does not match the selected candidate package."
    }
}

$requiredScenarios = @(
    "installerCleanInstall",
    "installerRepair",
    "installerMarkdownPdfDelivery",
    "portableLaunch",
    "portableMarkdownPdfDelivery"
)
foreach ($scenario in $requiredScenarios) {
    if ([string]$record.scenarios.$scenario -ne "passed") {
        throw "Representative acceptance scenario '$scenario' must be marked passed."
    }
}

$acceptance = [ordered]@{
    schemaVersion = "1.0"
    kind = "classroom-toolkit-representative-acceptance"
    status = "accepted"
    version = $Version
    sourceCommit = $SourceCommit.ToLowerInvariant()
    candidateRunId = $CandidateRunId
    acceptedAt = $acceptedAt.ToUniversalTime().ToString("O")
    submittedByGitHubActor = $GitHubActor
    tester = [ordered]@{
        identifier = ([string]$record.tester.identifier).Trim()
        role = "representative-non-developer"
    }
    releaseOwnerConfirmation = [ordered]@{
        confirmedByGitHubActor = $GitHubActor
        acknowledgement = [string]$record.acknowledgement
    }
    evidenceReference = ([string]$record.evidenceReference).Trim()
    assets = @($packageFacts | ForEach-Object {
        [ordered]@{
            kind = $_.kind
            path = $_.path
            bytes = $_.bytes
            sha256 = $_.sha256
        }
    })
    scenarios = [ordered]@{
        installerCleanInstall = "passed"
        installerRepair = "passed"
        installerMarkdownPdfDelivery = "passed"
        portableLaunch = "passed"
        portableMarkdownPdfDelivery = "passed"
    }
}

$acceptancePath = Join-Path $versionRoot "_release-metadata/representative-acceptance.json"
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($acceptancePath)) | Out-Null
Write-JsonFileAtomic -PathValue $acceptancePath -Value $acceptance
Write-Host "Representative acceptance verified for version $Version, candidate run $CandidateRunId."
Write-Host "Acceptance record: $acceptancePath"
