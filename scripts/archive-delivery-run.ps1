#requires -Version 7
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RunDirectory,

    [string]$RepositoryRoot = "",

    [string]$ArchiveRoot = "D:\CODE\classroom-answer-toolkit-archive\正式交付-2017-2023"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    Split-Path -Parent $PSScriptRoot
}
else {
    [IO.Path]::GetFullPath($RepositoryRoot)
}
$deliveriesRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "正式交付"))

$resolvedRunDirectory = if ([IO.Path]::IsPathFullyQualified($RunDirectory)) {
    [IO.Path]::GetFullPath($RunDirectory)
}
else {
    [IO.Path]::GetFullPath((Join-Path $deliveriesRoot $RunDirectory))
}
# A trailing separator survives GetFullPath but shifts every Substring($length + 1)
# by one character below, silently corrupting archived names and manifest entries.
$resolvedRunDirectory = $resolvedRunDirectory.TrimEnd('\', '/')

$runParent = [IO.Path]::GetFullPath((Split-Path -Parent $resolvedRunDirectory))
if (-not [string]::Equals($runParent, $deliveriesRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Run directory must be a direct child of ${deliveriesRoot}: $resolvedRunDirectory"
}
if (-not (Test-Path -LiteralPath $resolvedRunDirectory -PathType Container)) {
    throw "Run directory not found: $resolvedRunDirectory"
}

$runName = Split-Path -Leaf $resolvedRunDirectory

# Only completed deliveries belong in the read-only archive: archiving a failed or
# partial run freezes broken artifacts (and their hashes) into the manifest.
$receiptFiles = @(Get-ChildItem -LiteralPath $resolvedRunDirectory -File -Filter "*.workflow-run.json")
if ($receiptFiles.Count -eq 0) {
    throw "No workflow-run receipt (*.workflow-run.json) found in the run directory; refusing to archive an unverified delivery."
}
if ($receiptFiles.Count -gt 1) {
    throw "Ambiguous workflow-run receipts in the run directory: $($receiptFiles.Count)"
}
$workflowReceipt = Get-Content -LiteralPath $receiptFiles[0].FullName -Raw | ConvertFrom-Json
if ($workflowReceipt.status -ne "succeeded") {
    throw ("Refusing to archive a delivery whose workflow-run status is '{0}': {1}" -f $workflowReceipt.status, $receiptFiles[0].FullName)
}
$destinationDirectory = Join-Path (Join-Path $ArchiveRoot "正式交付") $runName
if (Test-Path -LiteralPath $destinationDirectory) {
    throw "Archive destination already exists (remove it first to re-archive): $destinationDirectory"
}

$manifestPath = Join-Path $ArchiveRoot "ARCHIVE-MANIFEST.txt"
$manifestHashByPath = @{}
if (Test-Path -LiteralPath $manifestPath) {
    foreach ($line in @(Get-Content -LiteralPath $manifestPath)) {
        $separator = $line.IndexOf("  ")
        if ($separator -gt 0) {
            $manifestHashByPath[$line.Substring($separator + 2)] = $line.Substring(0, $separator)
        }
    }
}

$files = @(Get-ChildItem -LiteralPath $resolvedRunDirectory -File -Recurse -Force | Sort-Object FullName)
if ($files.Count -eq 0) {
    throw "Run directory contains no files: $resolvedRunDirectory"
}
# Reparse points (symlinks/junctions) must not sneak foreign content into the
# read-only archive or leave dangling links behind after the source moves.
$linkFiles = @($files | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($linkFiles.Count -gt 0) {
    throw ("Run directory contains reparse-point files; remove them before archiving: {0}" -f (($linkFiles | Select-Object -First 3 -ExpandProperty FullName) -join ", "))
}

$totalBytes = 0
$appendedLines = [Collections.Generic.List[string]]::new()
try {
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
        if ($manifestHashByPath.ContainsKey($relativePath) -and $manifestHashByPath[$relativePath] -ne $sourceHash) {
            throw "Archived payload drifted from the manifest hash; resolve the stale manifest entry explicitly before re-archiving: $relativePath"
        }

        Set-ItemProperty -LiteralPath $destinationPath -Name IsReadOnly -Value $true
        $totalBytes += $file.Length
        if (-not $manifestHashByPath.ContainsKey($relativePath)) {
            $appendedLines.Add("$sourceHash  $relativePath")
        }
    }
}
catch {
    # 部分归档不留半成品：清掉本次已复制的目标目录后再抛出，重跑即从干净状态开始。
    if (Test-Path -LiteralPath $destinationDirectory) {
        Remove-Item -LiteralPath $destinationDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}

if ($appendedLines.Count -gt 0) {
    Add-Content -LiteralPath $manifestPath -Value $appendedLines -Encoding utf8
}

Write-Host "Archived run: $runName"
Write-Host ("- files: {0}; bytes: {1}; manifest appended: {2}" -f $files.Count, $totalBytes, $appendedLines.Count)
Write-Host "Destination: $destinationDirectory"
Write-Host "Source untouched; policy: archived runs stay out of Git unless admitted as explicit baselines."
