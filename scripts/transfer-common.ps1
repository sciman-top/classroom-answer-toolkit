#requires -Version 7
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
    # Windows path comparison is case-insensitive; a case-sensitive hashtable
    # would fail to exclude a manifest named Transfer-Manifest.json.
    $excluded = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($relative in $ExcludeRelativePaths) {
        [void]$excluded.Add($relative.Replace("\", "/"))
    }

    return @(
        Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
            $relativePath = [IO.Path]::GetRelativePath($root, $_.FullName).Replace("\", "/")
            if (-not $excluded.Contains($relativePath)) {
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
    $latestWriteAt = if ($entries.Count -gt 0) {
        ($entries | Sort-Object { $_["lastWriteAt"] } -Descending | Select-Object -First 1)["lastWriteAt"]
    }
    else {
        $null
    }

    return [ordered]@{
        algorithm = "sha256"
        sha256 = $treeHash
        fileCount = $entries.Count
        bytes = [long]$totalBytes
        latestWriteAt = $latestWriteAt
    }
}

# Replacing a destination repeatedly would otherwise accumulate one sibling
# backup per run forever. Keep the newest recovery point(s) and report the rest.
function Remove-SupersededSiblingBackups {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$SuffixPrefix,
        [int]$Keep = 1
    )

    $resolved = [IO.Path]::GetFullPath($BasePath)
    $parent = [IO.Path]::GetDirectoryName($resolved)
    $leaf = [IO.Path]::GetFileName($resolved)
    if ([string]::IsNullOrWhiteSpace($parent) -or [string]::IsNullOrWhiteSpace($leaf)) {
        return
    }

    $pattern = "$leaf$SuffixPrefix*"
    $candidates = @(
        Get-ChildItem -LiteralPath $parent -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like $pattern } |
            Sort-Object -Property LastWriteTimeUtc -Descending
    )
    if ($candidates.Count -le $Keep) {
        return
    }

    foreach ($stale in $candidates[$Keep..($candidates.Count - 1)]) {
        Write-Host "Removing superseded backup: $($stale.FullName)"
        if ($stale.PSIsContainer) {
            Remove-Item -LiteralPath $stale.FullName -Recurse -Force
        }
        else {
            Remove-Item -LiteralPath $stale.FullName -Force
        }
    }
}

function Write-JsonFileAtomic {    param(
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

# Copies license/notices into a package. Developer-operator preview packages
# additionally ship the .NET/desktop/MVVM runtime licenses resolved from the
# publish dependency manifest; ordinary-user packages only need the two
# repository-level files.
function Copy-PublishNotices {
    param(
        [Parameter(Mandatory = $true)][string]$DestinationDirectory,
        [switch]$IncludeRuntimeLicenses
    )

    Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $DestinationDirectory "LICENSE.txt") -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $DestinationDirectory "THIRD_PARTY_NOTICES.md") -Force

    if (-not $IncludeRuntimeLicenses) {
        return
    }

    $depsPath = Join-Path $repoRoot "src/ClassroomToolkit.App/obj/Release/net10.0-windows/win-x64/ClassroomToolkit.App.deps.json"
    if (-not (Test-Path -LiteralPath $depsPath -PathType Leaf)) {
        throw "Published application dependency manifest was not found: $depsPath"
    }
    $deps = Get-Content -LiteralPath $depsPath -Raw -Encoding utf8 | ConvertFrom-Json
    $libraryNames = @($deps.libraries.PSObject.Properties.Name)
    $runtimeLibrary = @($libraryNames | Where-Object { $_ -like "runtimepack.Microsoft.NETCore.App.Runtime.win-x64/*" }) | Select-Object -First 1
    $desktopLibrary = @($libraryNames | Where-Object { $_ -like "runtimepack.Microsoft.WindowsDesktop.App.Runtime.win-x64/*" }) | Select-Object -First 1
    $toolkitLibrary = @($libraryNames | Where-Object { $_ -like "CommunityToolkit.Mvvm/*" }) | Select-Object -First 1
    if (-not $runtimeLibrary -or -not $desktopLibrary -or -not $toolkitLibrary) {
        throw "Unable to resolve runtime notice package versions from the publish dependency manifest."
    }

    $nugetRoot = if ([string]::IsNullOrWhiteSpace($env:NUGET_PACKAGES)) {
        Join-Path $env:USERPROFILE ".nuget/packages"
    }
    else {
        [IO.Path]::GetFullPath($env:NUGET_PACKAGES)
    }
    $runtimeVersion = ($runtimeLibrary -split "/")[-1]
    $desktopVersion = ($desktopLibrary -split "/")[-1]
    $toolkitVersion = ($toolkitLibrary -split "/")[-1]
    $noticeFiles = [ordered]@{
        (Join-Path $nugetRoot "microsoft.netcore.app.runtime.win-x64/$runtimeVersion/LICENSE.TXT") = "DOTNET-LICENSE.txt"
        (Join-Path $nugetRoot "microsoft.netcore.app.runtime.win-x64/$runtimeVersion/THIRD-PARTY-NOTICES.TXT") = "DOTNET-THIRD-PARTY-NOTICES.txt"
        (Join-Path $nugetRoot "microsoft.windowsdesktop.app.runtime.win-x64/$desktopVersion/LICENSE") = "WINDOWS-DESKTOP-RUNTIME-LICENSE.txt"
        (Join-Path $nugetRoot "communitytoolkit.mvvm/$toolkitVersion/License.md") = "COMMUNITYTOOLKIT-MVVM-LICENSE.md"
        (Join-Path $nugetRoot "communitytoolkit.mvvm/$toolkitVersion/ThirdPartyNotices.txt") = "COMMUNITYTOOLKIT-MVVM-NOTICES.txt"
    }
    foreach ($entry in $noticeFiles.GetEnumerator()) {
        if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) {
            throw "Required runtime notice file was not found: $($entry.Key)"
        }
        Copy-Item -LiteralPath $entry.Key -Destination (Join-Path $DestinationDirectory $entry.Value) -Force
    }
}

function Get-WorkingTreeFiles {
    param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

    # git -z emits raw UTF-8 bytes; PowerShell decodes native output through
    # [Console]::OutputEncoding, which defaults to the GBK OEM page on Chinese
    # Windows and mojibakes every non-ASCII tracked path (e.g. 广州物理中考试卷).
    $previousEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    try {
        $output = & git -C $RepositoryRoot ls-files --cached --others --exclude-standard -z
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to enumerate the working tree with git."
        }
    }
    finally {
        [Console]::OutputEncoding = $previousEncoding
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
            # Fail loudly: a tracked-but-deleted (or mis-decoded) path would
            # otherwise silently ship an incomplete transfer that imports green.
            throw "Working-tree file listed by git is missing on disk: $sourcePath"
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
