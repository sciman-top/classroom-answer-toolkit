#requires -Version 7
param(
    [string]$ArtifactsRoot = "artifacts",
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$KeepVersion
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$root = if ([IO.Path]::IsPathFullyQualified($ArtifactsRoot)) {
    [IO.Path]::GetFullPath($ArtifactsRoot)
}
else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $ArtifactsRoot))
}

# This script deletes recursively. An unvalidated root such as ".", "C:\" or a
# source directory would silently destroy tracked source, so the root must
# prove it is a disposable artifacts directory before anything is removed.
function Assert-SafeArtifactsRoot {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )

    $separators = @([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $resolved = [IO.Path]::GetFullPath($RootPath).TrimEnd($separators)
    $resolvedWithSeparator = $resolved + [IO.Path]::DirectorySeparatorChar
    $repositoryWithSeparator = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd($separators) + [IO.Path]::DirectorySeparatorChar

    $leaf = [IO.Path]::GetFileName($resolved)
    if (-not [string]::Equals($leaf, "artifacts", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean '$resolved': an artifacts root must be a directory named 'artifacts'."
    }

    if ($repositoryWithSeparator.StartsWith($resolvedWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean '$resolved': it contains the repository root."
    }

    # Defence in depth: a mislabelled directory that still holds repository
    # source must never be treated as generated output.
    foreach ($protected in @(".git", "src", "scripts", "tests", "tools", "prompts", "eval", "ClassroomToolkit.sln")) {
        if (Test-Path -LiteralPath (Join-Path $resolved $protected)) {
            throw "Refusing to clean '$resolved': it contains repository source '$protected'."
        }
    }

    return $resolved
}

$root = Assert-SafeArtifactsRoot -RootPath $root -RepositoryRoot $repoRoot

if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Write-Host "Artifacts directory does not exist: $root"
    return
}

$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

# Every deletion target must stay strictly inside the validated artifacts root.
function Assert-ChildOfArtifactsRoot {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$RootPrefix
    )

    $candidate = [IO.Path]::GetFullPath($PathValue)
    if (-not $candidate.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a path outside the artifacts root: $candidate"
    }

    return $candidate
}

$removed = [Collections.Generic.List[string]]::new()
foreach ($name in @("work", "diagnostics", "publish", "tools")) {
    $candidate = Assert-ChildOfArtifactsRoot -PathValue (Join-Path $root $name) -RootPrefix $rootPrefix
    if (Test-Path -LiteralPath $candidate) {
        if ($name -eq "work" -and (Test-Path -LiteralPath (Join-Path $candidate "README.md") -PathType Leaf)) {
            foreach ($child in @(Get-ChildItem -LiteralPath $candidate -Force | Where-Object { $_.Name -ne "README.md" })) {
                $childPath = Assert-ChildOfArtifactsRoot -PathValue $child.FullName -RootPrefix $rootPrefix
                if ($child.PSIsContainer) {
                    [IO.Directory]::Delete($childPath, $true)
                }
                else {
                    [IO.File]::Delete($childPath)
                }
                $removed.Add($childPath)
            }
        }
        else {
            [IO.Directory]::Delete($candidate, $true)
            $removed.Add($candidate)
        }
    }
}

$deliveriesRoot = Join-Path $root "deliveries"
if (Test-Path -LiteralPath $deliveriesRoot -PathType Container) {
    foreach ($deliveryDirectory in @(Get-ChildItem -LiteralPath $deliveriesRoot -Directory -Force)) {
        if ($deliveryDirectory.Name -ne $KeepVersion) {
            $deliveryPath = Assert-ChildOfArtifactsRoot -PathValue $deliveryDirectory.FullName -RootPrefix $rootPrefix
            [IO.Directory]::Delete($deliveryPath, $true)
            $removed.Add($deliveryPath)
        }
    }

    $releaseRoot = Join-Path $deliveriesRoot $KeepVersion
    if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
        $sbomPath = Join-Path $releaseRoot "_release-metadata/sbom/spdx_2.2/manifest.spdx.json"
        if (Test-Path -LiteralPath $sbomPath -PathType Leaf) {
            try {
                $sbom = Get-Content -LiteralPath $sbomPath -Raw -Encoding utf8 | ConvertFrom-Json
                if ([string]$sbom.name -ne "ClassroomToolkit $KeepVersion") {
                    $sbomRoot = Assert-ChildOfArtifactsRoot -PathValue (Join-Path $releaseRoot "_release-metadata/sbom") -RootPrefix $rootPrefix
                    [IO.Directory]::Delete($sbomRoot, $true)
                    $removed.Add($sbomRoot)
                }
            }
            catch {
                Write-Warning "Unable to validate the release SBOM; preserving it: $sbomPath"
            }
        }

        $expectedDirectories = @("installer", "portable", "source", "private-transfer", "_release-metadata")
        foreach ($item in @(Get-ChildItem -LiteralPath $releaseRoot -Force)) {
            if ($item.PSIsContainer -and $item.Name -notin $expectedDirectories) {
                Write-Warning "Unknown delivery type was preserved: $($item.FullName)"
            }
        }
    }
}

Write-Host "Artifacts cleanup root: $root"
if ($removed.Count -eq 0) {
    Write-Host "No removable generated artifacts found."
}
else {
    Write-Host "Removed generated artifacts:"
    $removed | ForEach-Object { Write-Host "- $_" }
}

$unknown = @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -notin @("README.md", "deliveries", "history", "work") })
if ($unknown.Count -gt 0) {
    Write-Warning "Unknown artifacts entries were preserved: $($unknown.Name -join ', ')"
}
