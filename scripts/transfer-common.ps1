# Shared helpers for source transfer and release packaging.
# PowerShell 7 only: callers must run with pwsh -NoProfile.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-TransferPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ([IO.Path]::IsPathFullyQualified($PathValue)) {
        return [IO.Path]::GetFullPath($PathValue)
    }

    return [IO.Path]::GetFullPath((Join-Path $BasePath $PathValue))
}

function Assert-ContainedPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$RootPath,
        [string]$Description = "path"
    )

    $root = [IO.Path]::GetFullPath($RootPath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath($PathValue)
    if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Description escapes its containing root: $candidate"
    }

    return $candidate
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$FailureMessage = "Native command failed."
    )

    & $FileName @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage exit=$LASTEXITCODE"
    }
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    return (Get-FileHash -LiteralPath $PathValue -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RelativeFileManifest {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [string[]]$ExcludeRelativePaths = @()
    )

    $root = [IO.Path]::GetFullPath($RootPath)
    $excluded = @{}
    foreach ($relative in $ExcludeRelativePaths) {
        $excluded[$relative.Replace("\", "/")] = $true
    }

    return @(
        Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
            $relativePath = [IO.Path]::GetRelativePath($root, $_.FullName).Replace("\", "/")
            if (-not $excluded.ContainsKey($relativePath)) {
                [ordered]@{
                    path = $relativePath
                    bytes = $_.Length
                    sha256 = Get-FileSha256 -PathValue $_.FullName
                }
            }
        } | Sort-Object { $_["path"] }
    )
}

function Get-DirectoryTreeReceipt {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)

    $root = [IO.Path]::GetFullPath($DirectoryPath)
    $entries = @(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
        [ordered]@{
            relativePath = [IO.Path]::GetRelativePath($root, $_.FullName).Replace("\", "/")
            bytes = $_.Length
            sha256 = Get-FileSha256 -PathValue $_.FullName
            lastWriteAt = $_.LastWriteTimeUtc.ToString("O")
        }
    } | Sort-Object { $_["relativePath"] })
    $canonical = ($entries | ForEach-Object { "{0}|{1}|{2}" -f $_["relativePath"], $_["bytes"], $_["sha256"] }) -join "`n"
    $treeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))).ToLowerInvariant()
    $totalBytes = ($entries | ForEach-Object { [long]$_["bytes"] } | Measure-Object -Sum).Sum
    if ($null -eq $totalBytes) {
        $totalBytes = 0
    }

    return [ordered]@{
        algorithm = "sha256"
        sha256 = $treeHash
        fileCount = $entries.Count
        bytes = [long]$totalBytes
    }
}

function Write-JsonFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = [IO.Path]::GetDirectoryName($PathValue)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($PathValue), [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporaryPath, $PathValue, $true)
    }
    finally {
        [IO.File]::Delete($temporaryPath)
    }
}

function Get-WorkingTreeFiles {
    param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

    $output = & git -C $RepositoryRoot ls-files --cached --others --exclude-standard -z
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to enumerate the working tree with git."
    }

    return @($output -join "" -split "`0" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Copy-RelativeFiles {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$DestinationRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )

    foreach ($relativePath in $RelativePaths) {
        $sourcePath = Assert-ContainedPath -PathValue (Join-Path $SourceRoot $relativePath) -RootPath $SourceRoot -Description "source file"
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            continue
        }

        $destinationPath = Assert-ContainedPath -PathValue (Join-Path $DestinationRoot $relativePath) -RootPath $DestinationRoot -Description "destination file"
        $destinationDirectory = [IO.Path]::GetDirectoryName($destinationPath)
        [IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
}

function Assert-ZipEntriesContained {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )

    Add-Type -AssemblyName System.IO.Compression
    $destination = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if ([IO.Path]::IsPathFullyQualified($entry.FullName) -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)') {
                throw "Unsafe archive entry: $($entry.FullName)"
            }

            $candidate = [IO.Path]::GetFullPath((Join-Path $DestinationRoot $entry.FullName))
            if (-not $candidate.StartsWith($destination, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Archive entry escapes destination: $($entry.FullName)"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}
