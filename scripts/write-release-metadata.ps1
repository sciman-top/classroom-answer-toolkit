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
    "installer/preview/ClassroomToolkit-$Version-win-x64.zip",
    "installer/preview/install-release.ps1",
    "installer/preview/update-manifest.json",
    "source/ClassroomToolkit-$Version-source.zip",
    "_release-metadata/sbom/spdx_2.2/manifest.spdx.json"
)
foreach ($relativePath in $requiredPublicPaths) {
    $path = Join-Path $versionRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required public release file is missing: $path"
    }
}

$stableSetupPath = Join-Path $versionRoot "installer/stable/ClassroomToolkit-$Version-setup.exe"
$stableManifestPath = Join-Path $versionRoot "installer/stable/install-manifest.json"
$stablePresent = (Test-Path -LiteralPath $stableSetupPath -PathType Leaf) -and
    (Test-Path -LiteralPath $stableManifestPath -PathType Leaf)
if ((Test-Path -LiteralPath $stableSetupPath -PathType Leaf) -xor (Test-Path -LiteralPath $stableManifestPath -PathType Leaf)) {
    throw "Ordinary-user installer is incomplete; setup.exe and install-manifest.json must be present together."
}

$publicPaths = [Collections.Generic.List[string]]::new()
$requiredPublicPaths | ForEach-Object { $publicPaths.Add($_) }
if ($stablePresent) {
    $publicPaths.Add("installer/stable/ClassroomToolkit-$Version-setup.exe")
    $publicPaths.Add("installer/stable/install-manifest.json")
}
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
            status = if ($stablePresent) { "packaged" } else { "blocked" }
            reason = if ($stablePresent) { $null } else { "signed writable runtime bundle and representative non-developer acceptance are not available" }
        },
        [ordered]@{
            kind = "preview-installer"
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
