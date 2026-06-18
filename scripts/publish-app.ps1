$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$publishDir = Join-Path $repoRoot "artifacts\publish\ClassroomToolkit.App"

dotnet publish src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -c Debug -r win-x64 --self-contained false -p:PublishSingleFile=true -p:PublishTrimmed=false -o $publishDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed."
}

Write-Host "Published to: $publishDir"
& (Join-Path $PSScriptRoot "smoke-installed-app.ps1") -PublishDir $publishDir
