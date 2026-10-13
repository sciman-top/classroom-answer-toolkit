#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$DeliveryRoot = "",
    [string]$SourceCommit = ""
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
$sourceCommit = if ([string]::IsNullOrWhiteSpace($SourceCommit)) {
    ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
}
else {
    $SourceCommit
}
if ($sourceCommit -notmatch '^[A-Fa-f0-9]{40}$') {
    throw "Source commit must be a full 40-character Git SHA: $sourceCommit"
}

$requiredPublicPaths = @(
    "installer/stable/ClassroomToolkit-$Version-setup.exe",
    "installer/stable/install-manifest.json",
    "installer/stable/update-manifest.json",
    "portable/ClassroomToolkit-$Version-portable-win-x64.zip",
    "source/ClassroomToolkit-$Version-source.zip",
    "_release-metadata/sbom/spdx_2.2/manifest.spdx.json",
    "_release-metadata/representative-acceptance.json"
)
foreach ($relativePath in $requiredPublicPaths) {
    $path = Join-Path $versionRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required public release file is missing: $path"
    }
}

$stableSetupPath = Join-Path $versionRoot "installer/stable/ClassroomToolkit-$Version-setup.exe"
$setupSignature = Get-AuthenticodeSignature -LiteralPath $stableSetupPath
if ($setupSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -and
    $setupSignature.Status -ne [Management.Automation.SignatureStatus]::NotSigned) {
    throw "Installer Authenticode inspection failed: $($setupSignature.Status)."
}
$installManifest = Get-Content -LiteralPath (Join-Path $versionRoot "installer/stable/install-manifest.json") -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$installManifest.schemaVersion -ne "1.0" -or
    [string]$installManifest.kind -ne "classroom-toolkit-install-manifest" -or
    [string]$installManifest.version -ne $Version -or
    -not [string]::Equals([string]$installManifest.sourceCommit, $sourceCommit, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Install manifest does not match release version $Version and source commit $sourceCommit."
}
$declaredSignatureStatus = [string]$installManifest.publisherSignature.status
$declaredSignerSubject = [string]$installManifest.publisherSignature.signerSubject
$declaredSignerThumbprint = [string]$installManifest.publisherSignature.signerThumbprint
if ($declaredSignatureStatus -ne [string]$setupSignature.Status) {
    throw "Install manifest Authenticode status does not match the setup executable."
}
if ($setupSignature.Status -eq [Management.Automation.SignatureStatus]::Valid) {
    $actualSignerThumbprint = [string]$setupSignature.SignerCertificate.Thumbprint
    if ([string]::IsNullOrWhiteSpace($declaredSignerThumbprint) -or
        -not [string]::Equals($declaredSignerThumbprint, $actualSignerThumbprint, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Install manifest publisher identity does not match the signed setup executable."
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($declaredSignerSubject) -or
    -not [string]::IsNullOrWhiteSpace($declaredSignerThumbprint)) {
    throw "Unsigned installer metadata must not declare a publisher identity."
}

$updateManifest = Get-Content -LiteralPath (Join-Path $versionRoot "installer/stable/update-manifest.json") -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$updateManifest.schemaVersion -ne "2.0" -or
    [string]$updateManifest.kind -ne "classroom-toolkit-update-manifest" -or
    [string]$updateManifest.version -ne $Version -or
    [string]$updateManifest.workspaceContract -ne [string]$installManifest.workspaceContract -or
    -not [string]::Equals([string]$updateManifest.sourceCommit, $sourceCommit, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update manifest does not match release version $Version, workspace contract and source commit."
}
$updateSignerThumbprint = [string]$updateManifest.publisherThumbprint
if (-not [string]::Equals($updateSignerThumbprint, $declaredSignerThumbprint, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update manifest publisherThumbprint does not match install manifest Authenticode identity."
}
$updateInstallerAssets = @($updateManifest.assets | Where-Object { [string]$_.kind -eq "installer" })
$actualSetupBytes = (Get-Item -LiteralPath $stableSetupPath).Length
$actualSetupHash = Get-FileSha256 -PathValue $stableSetupPath
$expectedSetupName = [IO.Path]::GetFileName($stableSetupPath)
$expectedSetupUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$expectedSetupName"
if ($updateInstallerAssets.Count -ne 1 -or
    [string]$updateInstallerAssets[0].name -ne $expectedSetupName -or
    [string]$updateInstallerAssets[0].url -ne $expectedSetupUrl -or
    [long]$updateInstallerAssets[0].bytes -ne $actualSetupBytes -or
    -not [string]::Equals([string]$updateInstallerAssets[0].sha256, $actualSetupHash, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Update manifest does not bind the current installer URL, byte count and SHA-256."
}

$acceptancePath = Join-Path $versionRoot "_release-metadata/representative-acceptance.json"
$acceptance = Get-Content -LiteralPath $acceptancePath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$acceptance.schemaVersion -ne "1.0" -or
    [string]$acceptance.kind -ne "classroom-toolkit-representative-acceptance" -or
    [string]$acceptance.status -ne "accepted" -or
    [string]$acceptance.version -ne $Version -or
    -not [string]::Equals([string]$acceptance.sourceCommit, $sourceCommit, [StringComparison]::OrdinalIgnoreCase) -or
    [string]$acceptance.candidateRunId -notmatch '^[1-9]\d*$' -or
    [string]::IsNullOrWhiteSpace([string]$acceptance.submittedByGitHubActor) -or
    [string]$acceptance.tester.role -ne "representative-non-developer" -or
    [string]::IsNullOrWhiteSpace([string]$acceptance.tester.identifier)) {
    throw "Release metadata requires a valid representative non-developer acceptance record for version $Version and source $sourceCommit."
}
foreach ($asset in @(
    [ordered]@{ kind = "installer"; path = "installer/stable/ClassroomToolkit-$Version-setup.exe"; file = $stableSetupPath },
    [ordered]@{ kind = "portable"; path = "portable/ClassroomToolkit-$Version-portable-win-x64.zip"; file = (Join-Path $versionRoot "portable/ClassroomToolkit-$Version-portable-win-x64.zip") }
)) {
    $acceptedAssets = @($acceptance.assets | Where-Object { [string]$_.kind -eq $asset.kind })
    $actualBytes = (Get-Item -LiteralPath $asset.file).Length
    $actualHash = Get-FileSha256 -PathValue $asset.file
    if ($acceptedAssets.Count -ne 1 -or
        [string]$acceptedAssets[0].path -ne $asset.path -or
        [long]$acceptedAssets[0].bytes -ne $actualBytes -or
        -not [string]::Equals([string]$acceptedAssets[0].sha256, $actualHash, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Representative acceptance does not bind the current $($asset.kind) package bytes."
    }
}
foreach ($scenario in @("installerCleanInstall", "installerRepair", "installerMarkdownPdfDelivery", "portableLaunch", "portableMarkdownPdfDelivery")) {
    if ([string]$acceptance.scenarios.$scenario -ne "passed") {
        throw "Representative acceptance scenario '$scenario' is missing or not passed."
    }
}

$publicPaths = [Collections.Generic.List[string]]::new()
$requiredPublicPaths | ForEach-Object { $publicPaths.Add($_) }
$files = @($publicPaths | Sort-Object | ForEach-Object {
    $relativePath = $_
    $path = Join-Path $versionRoot $relativePath
    [ordered]@{
        path = $relativePath
        bytes = (Get-Item -LiteralPath $path).Length
        sha256 = Get-FileSha256 -PathValue $path
    }
})

$metadataRoot = Join-Path $versionRoot "_release-metadata"
[IO.Directory]::CreateDirectory($metadataRoot) | Out-Null
$manifest = [ordered]@{
    schemaVersion = "1.0"
    kind = "classroom-toolkit-release-manifest"
    version = $Version
    sourceCommit = $sourceCommit.ToLowerInvariant()
    generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
    deliveries = @(
        [ordered]@{
            kind = "ordinary-user-installer"
            visibility = "public"
            status = "packaged"
        },
        [ordered]@{
            kind = "portable-user-package"
            visibility = "public"
            status = "packaged"
        },
        [ordered]@{
            kind = "source"
            visibility = "public"
            status = "packaged"
        },
        [ordered]@{
            kind = "private-maintainer-transfer"
            visibility = "local-only"
            status = if (Test-Path -LiteralPath (Join-Path $versionRoot "private-transfer/ClassroomToolkit-$Version-private-dev.zip") -PathType Leaf) { "packaged-locally" } else { "not-requested" }
        }
    )
    files = $files
}
Write-JsonFileAtomic -PathValue (Join-Path $metadataRoot "release-manifest.json") -Value $manifest

$checksumLines = @($files | ForEach-Object { "{0}  {1}" -f $_.sha256, $_.path })
[IO.File]::WriteAllText(
    (Join-Path $metadataRoot "checksums.sha256"),
    (($checksumLines -join "`n") + "`n"),
    [Text.UTF8Encoding]::new($false))

Write-Host "Release manifest: $(Join-Path $metadataRoot 'release-manifest.json')"
Write-Host "Release checksums: $(Join-Path $metadataRoot 'checksums.sha256')"
