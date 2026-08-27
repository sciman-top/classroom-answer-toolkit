#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$WorkspaceContract = "1",
    [string]$OutputDirectory = "artifacts\release",
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$outputRoot = Resolve-TransferPath -PathValue $OutputDirectory -BasePath $repoRoot
$stageParent = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-release-{0}" -f [Guid]::NewGuid().ToString("N"))
$appStageRoot = Join-Path $stageParent "app"
$publishRoot = Join-Path $repoRoot "artifacts/publish/ClassroomToolkit.App"
$appZipName = "ClassroomToolkit-$Version-win-x64.zip"
$sourceZipName = "ClassroomToolkit-$Version-source.zip"

if (-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim())) {
    throw "Release packaging requires a clean working tree. Commit or stash source changes first."
}

[IO.Directory]::CreateDirectory($stageParent) | Out-Null
[IO.Directory]::CreateDirectory($appStageRoot) | Out-Null
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null

try {
    if (-not $SkipPublish) {
        & (Join-Path $repoRoot "scripts/publish-app.ps1") `
            -RuntimeIdentifier "win-x64" `
            -Version $Version `
            -SelfContained
        if ($LASTEXITCODE -ne 0) {
            throw "Release application publish failed."
        }
    }

    if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
        throw "Published application directory was not found: $publishRoot"
    }

    $sourceArchive = Join-Path $outputRoot $sourceZipName
    Invoke-CheckedNative -FileName "git" -Arguments @("-C", $repoRoot, "archive", "--format=zip", "--output=$sourceArchive", "HEAD") -WorkingDirectory $repoRoot -FailureMessage "Unable to create the source archive."

    Copy-Item -Path (Join-Path $publishRoot "*") -Destination $appStageRoot -Recurse -Force

    $appUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$appZipName"
    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-update-manifest"
        channel = "stable"
        version = $Version
        releaseUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v$Version"
        releaseNotes = "Classroom Answer Toolkit $Version"
        sourceCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
        workspaceContract = $WorkspaceContract
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        assets = @(
            [ordered]@{
                kind = "app"
                name = $appZipName
                url = $appUrl
                sha256 = "pending"
                bytes = 0
            },
            [ordered]@{
                kind = "source"
                name = $sourceZipName
                url = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$sourceZipName"
                sha256 = Get-FileSha256 -PathValue $sourceArchive
                bytes = (Get-Item -LiteralPath $sourceArchive).Length
            }
        )
    }
    $appZipPath = Join-Path $outputRoot $appZipName
    if (Test-Path -LiteralPath $appZipPath) {
        Remove-Item -LiteralPath $appZipPath -Force
    }
    Compress-Archive -Path (Join-Path $appStageRoot "*") -DestinationPath $appZipPath -CompressionLevel Optimal

    $appItem = Get-Item -LiteralPath $appZipPath
    $manifest.assets[0].sha256 = Get-FileSha256 -PathValue $appZipPath
    $manifest.assets[0].bytes = $appItem.Length
    # Keep the manifest outside the package: embedding it would make its own
    # asset hash self-referential and impossible to verify deterministically.
    $manifestPath = Join-Path $outputRoot "update-manifest.json"
    Write-JsonFileAtomic -PathValue $manifestPath -Value $manifest

    Write-Host "Release package: $appZipPath"
    Write-Host "Source package: $(Join-Path $outputRoot $sourceZipName)"
    Write-Host "Update manifest: $manifestPath"
    Write-Host "Application package SHA-256: $(Get-FileSha256 -PathValue $appZipPath)"
}
finally {
    if (Test-Path -LiteralPath $stageParent) {
        Remove-Item -LiteralPath $stageParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}
