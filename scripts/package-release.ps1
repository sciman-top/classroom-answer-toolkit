#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$WorkspaceContract = "2",
    [ValidateSet("developer-operator-preview", "ordinary-users")][string]$Audience = "ordinary-users",
    [string]$OutputDirectory = "artifacts\deliveries",
    [string]$IsccPath = "",
    [string]$SigningCertificateThumbprint = "",
    [switch]$SkipPublish,
    [switch]$AllowUnsignedCandidate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($Audience -eq "ordinary-users") {
    $arguments = @{
        Version = $Version
        WorkspaceContract = $WorkspaceContract
        OutputDirectory = $OutputDirectory
        IsccPath = $IsccPath
        SigningCertificateThumbprint = $SigningCertificateThumbprint
        SkipPublish = $SkipPublish
        AllowUnsignedCandidate = $AllowUnsignedCandidate
    }
    & (Join-Path $PSScriptRoot "build-ordinary-user-package.ps1") @arguments
    # A .ps1 invoked with & never sets $LASTEXITCODE; build-ordinary fails via
    # throw, which Stop preference propagates before this line is reached.
    exit 0
}

. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$outputParent = Resolve-TransferPath -PathValue $OutputDirectory -BasePath $repoRoot
$outputRoot = Join-Path $outputParent $Version
$previewRoot = Join-Path $outputRoot "installer/preview"
$sourceRoot = Join-Path $outputRoot "source"
$stageParent = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-release-{0}" -f [Guid]::NewGuid().ToString("N"))
$appStageRoot = Join-Path $stageParent "app"
$publishRoot = Join-Path $repoRoot "artifacts/work/publish/ClassroomToolkit.App"
$smokeReportPath = Join-Path $repoRoot "artifacts/work/publish/verification/ClassroomToolkit.App.smoke-report.json"
$appZipName = "ClassroomToolkit-$Version-win-x64.zip"
$sourceZipName = "ClassroomToolkit-$Version-source.zip"
$currentCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())

$projectPath = Join-Path $repoRoot "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj"
[xml]$project = Get-Content -LiteralPath $projectPath -Raw -Encoding utf8
$projectVersionNode = $project.SelectSingleNode("/Project/PropertyGroup/Version")
$projectVersion = if ($null -eq $projectVersionNode) { "<missing>" } else { [string]$projectVersionNode.InnerText }
if ($projectVersion -ne $Version) {
    throw "Release version $Version does not match the source project version $projectVersion."
}

if (-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim())) {
    throw "Release packaging requires a clean working tree. Commit or stash source changes first."
}

[IO.Directory]::CreateDirectory($stageParent) | Out-Null
[IO.Directory]::CreateDirectory($appStageRoot) | Out-Null
[IO.Directory]::CreateDirectory($previewRoot) | Out-Null
[IO.Directory]::CreateDirectory($sourceRoot) | Out-Null

try {
    if (-not $SkipPublish) {
        # A .ps1 invoked with & never sets $LASTEXITCODE; publish-app fails via
        # throw, which Stop preference propagates.
        & (Join-Path $repoRoot "scripts/publish-app.ps1") `
            -RuntimeIdentifier "win-x64" `
            -Version $Version `
            -SelfContained
    }

    if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
        throw "Published application directory was not found: $publishRoot"
    }
    Assert-PublishReceipt -PublishDirectory $publishRoot -ReportPath $smokeReportPath -ExpectedCommit $currentCommit

    $publishedExe = Join-Path $publishRoot "ClassroomToolkit.App.exe"
    $publishedVersion = ([Diagnostics.FileVersionInfo]::GetVersionInfo($publishedExe).ProductVersion -split '\+')[0]
    if ($publishedVersion -ne $Version) {
        throw "Published application version $publishedVersion does not match release version $Version."
    }
    $signature = Get-AuthenticodeSignature -FilePath $publishedExe
    $sourceArchive = Join-Path $sourceRoot $sourceZipName
    Invoke-CheckedNative -FileName "git" -Arguments @("-C", $repoRoot, "archive", "--format=zip", "--output=$sourceArchive", "HEAD") -WorkingDirectory $repoRoot -FailureMessage "Unable to create the source archive."

    Copy-Item -Path (Join-Path $publishRoot "*") -Destination $appStageRoot -Recurse -Force
    Copy-PublishNotices -DestinationDirectory $appStageRoot -IncludeRuntimeLicenses

    $appUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$appZipName"
    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-update-manifest"
        channel = if ($Audience -eq "ordinary-users") { "stable" } else { "preview" }
        audience = $Audience
        version = $Version
        releaseUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v$Version"
        releaseNotes = "Classroom Answer Toolkit $Version"
        sourceCommit = $currentCommit
        workspaceContract = $WorkspaceContract
        publisherSignature = [ordered]@{
            status = [string]$signature.Status
            signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        }
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
    $appZipPath = Join-Path $previewRoot $appZipName
    if (Test-Path -LiteralPath $appZipPath) {
        Remove-Item -LiteralPath $appZipPath -Force
    }
    Compress-Archive -Path (Join-Path $appStageRoot "*") -DestinationPath $appZipPath -CompressionLevel Optimal

    $appItem = Get-Item -LiteralPath $appZipPath
    $manifest.assets[0].sha256 = Get-FileSha256 -PathValue $appZipPath
    $manifest.assets[0].bytes = $appItem.Length
    # Keep the manifest outside the package: embedding it would make its own
    # asset hash self-referential and impossible to verify deterministically.
    $manifestPath = Join-Path $previewRoot "update-manifest.json"
    Write-JsonFileAtomic -PathValue $manifestPath -Value $manifest
    Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/install-release.ps1") -Destination (Join-Path $previewRoot "install-release.ps1") -Force

    Write-Host "Release package: $appZipPath"
    Write-Host "Source package: $(Join-Path $sourceRoot $sourceZipName)"
    Write-Host "Update manifest: $manifestPath"
    Write-Host "Application package SHA-256: $(Get-FileSha256 -PathValue $appZipPath)"
}
finally {
    if (Test-Path -LiteralPath $stageParent) {
        Remove-Item -LiteralPath $stageParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}
