#requires -Version 7
param(
    [ValidateSet("PublicSource", "PrivateDev")][string]$Mode = "PublicSource",
    [string]$Output = "",
    [switch]$IncludeEnv,
    [switch]$IncludeGit,
    [switch]$IncludePublishedApp,
    [switch]$BuildPublishedApp,
    [ValidatePattern('^$|^\d+\.\d+\.\d+$')][string]$Version = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$Version = if ([string]::IsNullOrWhiteSpace($Version)) {
    [xml]$project = Get-Content -LiteralPath (Join-Path $repoRoot "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj") -Raw -Encoding utf8
    # SelectSingleNode, not a property cast: several PropertyGroup elements make
    # $project.Project.PropertyGroup.Version an array that stringifies to "a b".
    $versionNode = $project.SelectSingleNode("/Project/PropertyGroup/Version")
    if ($null -eq $versionNode) { "" } else { [string]$versionNode.InnerText }
}
else {
    $Version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Unable to resolve a semantic delivery version from the application project: $Version"
}
$defaultDeliveryType = if ($Mode -eq "PrivateDev") { "private-transfer" } else { "source" }
$defaultFileName = if ($Mode -eq "PrivateDev") {
    "ClassroomToolkit-$Version-private-dev.zip"
}
else {
    "ClassroomToolkit-$Version-source.zip"
}
$outputPath = if ([string]::IsNullOrWhiteSpace($Output)) {
    Join-Path $repoRoot "artifacts/deliveries/$Version/$defaultDeliveryType/$defaultFileName"
}
else {
    [IO.Path]::GetFullPath($Output)
}
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
            # A .ps1 invoked with & never sets $LASTEXITCODE; publish-app fails
            # via throw, which Stop preference propagates.
            & (Join-Path $repoRoot "scripts/publish-app.ps1")
        }

        $publishRoot = Join-Path $repoRoot "artifacts/work/publish/ClassroomToolkit.App"
        if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
            throw "Published application was requested but not found: $publishRoot"
        }
        # A reused tree must bind the current clean commit exactly like
        # package-release requires; otherwise the transfer manifest below would
        # name a sourceCommit the binaries were never built from.
        Assert-PublishReceipt -PublishDirectory $publishRoot `
            -ReportPath (Join-Path $repoRoot "artifacts/work/publish/verification/ClassroomToolkit.App.smoke-report.json") `
            -ExpectedCommit ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
        $appDestination = Join-Path $sourceRoot "app"
        [IO.Directory]::CreateDirectory($appDestination) | Out-Null
        Copy-Item -Path (Join-Path $publishRoot "*") -Destination $appDestination -Recurse -Force
    }

    $setupScript = Join-Path $repoRoot "scripts/setup-development.ps1"
    if (Test-Path -LiteralPath $setupScript -PathType Leaf) {
        Copy-Item -LiteralPath $setupScript -Destination (Join-Path $sourceRoot "scripts/setup-development.ps1") -Force
    }

    $sourceCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
    # An unchecked git failure used to write an empty commit while
    # write-release-metadata.ps1 demands a full 40-hex SHA, so the transfer
    # manifest silently became untraceable.
    if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[A-Fa-f0-9]{40}$') {
        throw "Unable to resolve the source commit for the transfer manifest: '$sourceCommit'"
    }
    $sourceStatus = ((& git -C $repoRoot status --porcelain 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the working tree status for the transfer manifest."
    }

    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-transfer"
        mode = $Mode
        version = $Version
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        sourceCommit = $sourceCommit
        sourceDirty = -not [string]::IsNullOrWhiteSpace($sourceStatus)
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
