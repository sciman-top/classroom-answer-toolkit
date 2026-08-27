param(
    [string]$RuntimeIdentifier = "win-x64",
    [string]$PublishDir = "artifacts\publish\ClassroomToolkit.App",
    [string]$Version = "",
    [switch]$SelfContained
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$publishDir = if ([IO.Path]::IsPathFullyQualified($PublishDir)) {
    [IO.Path]::GetFullPath($PublishDir)
}
else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $PublishDir))
}
$smokeReportPath = Join-Path $repoRoot "artifacts\publish\verification\ClassroomToolkit.App.smoke-report.json"

Remove-Item -LiteralPath $publishDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $smokeReportPath -Force -ErrorAction SilentlyContinue

dotnet restore src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -r $RuntimeIdentifier
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed for publish runtime."
}

$publishArguments = @(
    "publish", "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj",
    "-c", "Release", "-r", $RuntimeIdentifier,
    "--self-contained", $SelfContained.IsPresent.ToString().ToLowerInvariant(),
    "-p:PublishSingleFile=true", "-p:PublishTrimmed=false", "-o", $publishDir
)
if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $publishArguments += "-p:Version=$Version"
}

& dotnet @publishArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed."
}

Write-Host "Published to: $publishDir"
& (Join-Path $PSScriptRoot "smoke-installed-app.ps1") -PublishDir $publishDir -ReportPath $smokeReportPath
if ($LASTEXITCODE -ne 0) {
    throw "Published app smoke failed."
}

Write-Host "Publish smoke report: $smokeReportPath"
