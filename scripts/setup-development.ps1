#requires -Version 7
param(
    [string]$RepositoryRoot = "",
    [switch]$NoInstall,
    [switch]$SkipBuild,
    [switch]$SkipTests,
    [switch]$SkipCore
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    [IO.Path]::GetFullPath((Join-Path $scriptRoot ".."))
}
else {
    [IO.Path]::GetFullPath($RepositoryRoot)
}
Set-Location $repoRoot

function Test-CommandAvailable {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $processPath = [Environment]::GetEnvironmentVariable("Path", "Process")
    $segments = @($processPath, $machinePath, $userPath) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_ -split ';' } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    [Environment]::SetEnvironmentVariable("Path", ($segments -join ';'), "Process")
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    if (-not (Test-CommandAvailable "winget")) {
        throw "$DisplayName is missing and winget is unavailable; install it manually or rerun without -NoInstall on a supported Windows host."
    }

    Write-Host "Installing $DisplayName with winget..."
    & winget install --id $Id --exact --accept-source-agreements --accept-package-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install $DisplayName with winget."
    }
}

function Assert-OrInstallCommand {
    param(
        [Parameter(Mandatory = $true)][string]$CommandName,
        [Parameter(Mandatory = $true)][string]$PackageId,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    if (Test-CommandAvailable $CommandName) {
        return
    }
    if ($NoInstall) {
        throw "$DisplayName is missing: $CommandName"
    }

    Install-WingetPackage -Id $PackageId -DisplayName $DisplayName
    Refresh-ProcessPath
    if (-not (Test-CommandAvailable $CommandName)) {
        throw "$DisplayName was installed but $CommandName is still unavailable in this process. Open a new pwsh session and rerun."
    }
}

Assert-OrInstallCommand -CommandName "node" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
Assert-OrInstallCommand -CommandName "npm" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "npm"

if (-not (Test-CommandAvailable "dotnet") -and $NoInstall) {
    throw ".NET SDK is missing: dotnet"
}
if (-not (Test-CommandAvailable "dotnet") -and -not $NoInstall) {
    Install-WingetPackage -Id "Microsoft.DotNet.SDK.10" -DisplayName ".NET 10 SDK"
}

if (-not (Test-CommandAvailable "pwsh")) {
    throw "PowerShell 7 is required to run this setup script."
}

$envTemplate = Join-Path $repoRoot ".env.example"
$envPath = Join-Path $repoRoot ".env"
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf) -and (Test-Path -LiteralPath $envTemplate -PathType Leaf)) {
    Copy-Item -LiteralPath $envTemplate -Destination $envPath
    Write-Host "Created local .env from .env.example; cloud egress remains disabled until configured."
}

Write-Host "Restoring the repository toolchain..."
& (Join-Path $repoRoot "scripts/bootstrap.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Bootstrap failed."
}

if (-not $SkipBuild) {
    Write-Host "Building ClassroomToolkit.sln..."
    & dotnet build (Join-Path $repoRoot "ClassroomToolkit.sln") -c Debug
    if ($LASTEXITCODE -ne 0) {
        throw "Debug build failed."
    }
}

if (-not $SkipTests) {
    Write-Host "Running ordinary tests..."
    & dotnet test (Join-Path $repoRoot "tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj") -c Debug --no-build --filter "Gate!=ToolchainIntegration"
    if ($LASTEXITCODE -ne 0) {
        throw "Ordinary tests failed."
    }
}

if (-not $SkipCore) {
    Write-Host "Running the Core toolchain gate..."
    & (Join-Path $repoRoot "scripts/check-toolchain.ps1") -Mode Core -SubjectPack junior-physics-answer
    if ($LASTEXITCODE -ne 0) {
        throw "Core toolchain gate failed."
    }
}

Write-Host "Development setup complete: $repoRoot"
