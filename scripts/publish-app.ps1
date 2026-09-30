#requires -Version 7
param(
    [string]$RuntimeIdentifier = "win-x64",
    [string]$PublishDir = "artifacts\work\publish\ClassroomToolkit.App",
    [string]$Version = "",
    [switch]$SelfContained
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

# This script clears its output directory recursively before publishing. Keep
# that directory pinned under artifacts\work\publish so a mistyped -PublishDir
# ("." or an absolute source path) cannot wipe anything outside generated output.
$publishRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts\work\publish"))
$publishRootPrefix = $publishRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

$publishDir = if ([IO.Path]::IsPathFullyQualified($PublishDir)) {
    [IO.Path]::GetFullPath($PublishDir)
}
else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $PublishDir))
}
if (-not $publishDir.StartsWith($publishRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "PublishDir must stay under $publishRoot; refusing to clear '$publishDir'."
}

$smokeReportPath = Join-Path $publishRoot "verification\ClassroomToolkit.App.smoke-report.json"

if (Test-Path -LiteralPath $publishDir) {
    Write-Host "Clearing publish directory: $publishDir"
    Remove-Item -LiteralPath $publishDir -Recurse -Force -ErrorAction Stop
}
if (Test-Path -LiteralPath $smokeReportPath) {
    Remove-Item -LiteralPath $smokeReportPath -Force -ErrorAction Stop
}

dotnet restore src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -r $RuntimeIdentifier
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed for publish runtime."
}

$publishArguments = @(
    "publish", "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj",
    "-c", "Release", "-r", $RuntimeIdentifier,
    "--self-contained", $SelfContained.IsPresent.ToString().ToLowerInvariant(),
    "-p:PublishSingleFile=true", "-p:PublishTrimmed=false",
    "-p:DebugType=None", "-p:DebugSymbols=false", "-o", $publishDir
)
if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $publishArguments += "-p:Version=$Version"
}

& dotnet @publishArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed."
}

Write-Host "Published to: $publishDir"
# smoke-installed-app.ps1 fails via throw, which $ErrorActionPreference = "Stop"
# propagates; $LASTEXITCODE is not set by a "&"-invoked script and checking it
# would silently pass a failed smoke.
& (Join-Path $PSScriptRoot "smoke-installed-app.ps1") -PublishDir $publishDir -ReportPath $smokeReportPath

Write-Host "Publish smoke report: $smokeReportPath"
