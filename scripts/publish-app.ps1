$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$runtimeIdentifier = "win-x64"
$publishDir = Join-Path $repoRoot "artifacts\publish\ClassroomToolkit.App"
$smokeReportPath = Join-Path $repoRoot "artifacts\publish\verification\ClassroomToolkit.App.smoke-report.json"

dotnet restore src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -r $runtimeIdentifier
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed for publish runtime."
}

dotnet publish src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -c Debug -r $runtimeIdentifier --self-contained false -p:PublishSingleFile=true -p:PublishTrimmed=false -o $publishDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed."
}

Write-Host "Published to: $publishDir"
& (Join-Path $PSScriptRoot "smoke-installed-app.ps1") -PublishDir $publishDir -ReportPath $smokeReportPath
if ($LASTEXITCODE -ne 0) {
    throw "Published app smoke failed."
}

Write-Host "Publish smoke report: $smokeReportPath"
