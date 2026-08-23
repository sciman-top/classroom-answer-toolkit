[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RunDirectory,

    [string]$ArchiveRoot = "D:\CODE\classroom-answer-toolkit-archive\正式交付-2017-2023"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$deliveriesRoot = Join-Path $repoRoot "正式交付"

$resolvedRunDirectory = if ([IO.Path]::IsPathFullyQualified($RunDirectory)) {
    [IO.Path]::GetFullPath($RunDirectory)
}
else {
    [IO.Path]::GetFullPath((Join-Path $deliveriesRoot $RunDirectory))
}

if (-not $resolvedRunDirectory.StartsWith($deliveriesRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Run directory must live under ${deliveriesRoot}: $resolvedRunDirectory"
}
if (-not (Test-Path -LiteralPath $resolvedRunDirectory -PathType Container)) {
    throw "Run directory not found: $resolvedRunDirectory"
}

$runName = Split-Path -Leaf $resolvedRunDirectory
$destinationDirectory = Join-Path (Join-Path $ArchiveRoot "正式交付") $runName
if (Test-Path -LiteralPath $destinationDirectory) {
    throw "Archive destination already exists (remove it first to re-archive): $destinationDirectory"
}

$manifestPath = Join-Path $ArchiveRoot "ARCHIVE-MANIFEST.txt"
$existingManifestLines = if (Test-Path -LiteralPath $manifestPath) {
    @(Get-Content -LiteralPath $manifestPath)
}
else {
    @()
}
$existingManifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($line in $existingManifestLines) {
    $separator = $line.IndexOf("  ")
    if ($separator -gt 0) {
        [void]$existingManifestPaths.Add($line.Substring($separator + 2))
    }
}

$files = @(Get-ChildItem -LiteralPath $resolvedRunDirectory -File -Recurse | Sort-Object FullName)
if ($files.Count -eq 0) {
    throw "Run directory contains no files: $resolvedRunDirectory"
}

$totalBytes = 0
$appendedLines = [Collections.Generic.List[string]]::new()
foreach ($file in $files) {
    $relativePath = "正式交付/$runName/" + $file.FullName.Substring($resolvedRunDirectory.Length + 1).Replace('\', '/')
    $destinationPath = Join-Path $destinationDirectory $file.FullName.Substring($resolvedRunDirectory.Length + 1)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destinationPath -Force

    $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne $destinationHash) {
        throw "Hash mismatch after copy: $relativePath"
    }

    Set-ItemProperty -LiteralPath $destinationPath -Name IsReadOnly -Value $true
    $totalBytes += $file.Length
    if ($existingManifestPaths.Add($relativePath)) {
        $appendedLines.Add("$sourceHash  $relativePath")
    }
}

if ($appendedLines.Count -gt 0) {
    Add-Content -LiteralPath $manifestPath -Value $appendedLines -Encoding utf8
}

Write-Host "Archived run: $runName"
Write-Host ("- files: {0}; bytes: {1}; manifest appended: {2}" -f $files.Count, $totalBytes, $appendedLines.Count)
Write-Host "Destination: $destinationDirectory"
Write-Host "Source untouched; policy: archived runs stay out of Git unless admitted as explicit baselines."
