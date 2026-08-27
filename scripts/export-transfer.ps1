#requires -Version 7
param(
    [ValidateSet("PublicSource", "PrivateDev")][string]$Mode = "PublicSource",
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$IncludeEnv,
    [switch]$IncludeGit,
    [switch]$IncludePublishedApp,
    [switch]$BuildPublishedApp,
    [string]$Version = "0.0.0-dev"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$outputPath = [IO.Path]::GetFullPath($Output)
$outputDirectory = [IO.Path]::GetDirectoryName($outputPath)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

if ($Mode -eq "PublicSource" -and ($IncludeEnv -or $IncludeGit)) {
    throw "PublicSource cannot include .env or .git. Use PrivateDev explicitly."
}
if ($IncludeEnv -and $Mode -ne "PrivateDev") {
    throw "-IncludeEnv is only valid for PrivateDev."
}
if ($IncludeEnv -and -not (Test-Path -LiteralPath (Join-Path $repoRoot ".env") -PathType Leaf)) {
    throw "-IncludeEnv was requested but .env is missing at the repository root."
}

$stageParent = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-transfer-{0}" -f [Guid]::NewGuid().ToString("N"))
$stageRoot = Join-Path $stageParent "package"
[IO.Directory]::CreateDirectory($stageRoot) | Out-Null
$sourceRoot = Join-Path $stageRoot "workspace"
[IO.Directory]::CreateDirectory($sourceRoot) | Out-Null

try {
    if ($Mode -eq "PublicSource") {
        $archivePath = Join-Path $stageParent "source.zip"
        Invoke-CheckedNative -FileName "git" -Arguments @("-C", $repoRoot, "archive", "--format=zip", "--output=$archivePath", "HEAD") -WorkingDirectory $repoRoot -FailureMessage "Unable to create the public source archive."
        Expand-Archive -LiteralPath $archivePath -DestinationPath $sourceRoot -Force
    }
    else {
        $relativeFiles = Get-WorkingTreeFiles -RepositoryRoot $repoRoot
        Copy-RelativeFiles -SourceRoot $repoRoot -DestinationRoot $sourceRoot -RelativePaths $relativeFiles
        if ($IncludeEnv) {
            Copy-Item -LiteralPath (Join-Path $repoRoot ".env") -Destination (Join-Path $sourceRoot ".env") -Force
        }
        if ($IncludeGit) {
            $gitDestination = Join-Path $sourceRoot ".git"
            Copy-Item -LiteralPath (Join-Path $repoRoot ".git") -Destination $gitDestination -Recurse -Force
        }
    }

    if ($IncludePublishedApp -or $BuildPublishedApp) {
        if ($BuildPublishedApp) {
            & (Join-Path $repoRoot "scripts/publish-app.ps1")
            if ($LASTEXITCODE -ne 0) {
                throw "Published application build failed."
            }
        }

        $publishRoot = Join-Path $repoRoot "artifacts/publish/ClassroomToolkit.App"
        if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
            throw "Published application was requested but not found: $publishRoot"
        }
        $appDestination = Join-Path $sourceRoot "app"
        [IO.Directory]::CreateDirectory($appDestination) | Out-Null
        Copy-Item -Path (Join-Path $publishRoot "*") -Destination $appDestination -Recurse -Force
    }

    $setupScript = Join-Path $repoRoot "scripts/setup-development.ps1"
    if (Test-Path -LiteralPath $setupScript -PathType Leaf) {
        Copy-Item -LiteralPath $setupScript -Destination (Join-Path $sourceRoot "scripts/setup-development.ps1") -Force
    }

    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-transfer"
        mode = $Mode
        version = $Version
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        sourceCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
        sourceDirty = -not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain | Out-String).Trim())
        envIncluded = $IncludeEnv.IsPresent
        gitIncluded = $IncludeGit.IsPresent
        publishedAppIncluded = ($IncludePublishedApp.IsPresent -or $BuildPublishedApp.IsPresent)
        files = Get-RelativeFileManifest -RootPath $stageRoot -ExcludeRelativePaths @("transfer-manifest.json")
    }
    Write-JsonFileAtomic -PathValue (Join-Path $stageRoot "transfer-manifest.json") -Value $manifest

    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath -Force
    }
    Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $outputPath -CompressionLevel Optimal

    $outputHash = Get-FileSha256 -PathValue $outputPath
    Write-Host "Transfer package: $outputPath"
    Write-Host "SHA-256: $outputHash"
    Write-Host "Mode: $Mode; sourceDirty=$($manifest.sourceDirty); envIncluded=$($manifest.envIncluded); gitIncluded=$($manifest.gitIncluded)"
}
finally {
    if (Test-Path -LiteralPath $stageParent) {
        Remove-Item -LiteralPath $stageParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}
