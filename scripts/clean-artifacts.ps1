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

if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Write-Host "Artifacts directory does not exist: $root"
    return
}

$removed = [Collections.Generic.List[string]]::new()
foreach ($name in @("work", "diagnostics", "publish", "review-queue-observation", "tools")) {
    $candidate = Join-Path $root $name
    if (Test-Path -LiteralPath $candidate) {
        if ($name -eq "work" -and (Test-Path -LiteralPath (Join-Path $candidate "README.md") -PathType Leaf)) {
            foreach ($child in @(Get-ChildItem -LiteralPath $candidate -Force | Where-Object { $_.Name -ne "README.md" })) {
                if ($child.PSIsContainer) {
                    [IO.Directory]::Delete($child.FullName, $true)
                }
                else {
                    [IO.File]::Delete($child.FullName)
                }
                $removed.Add($child.FullName)
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
            [IO.Directory]::Delete($deliveryDirectory.FullName, $true)
            $removed.Add($deliveryDirectory.FullName)
        }
    }

    $releaseRoot = Join-Path $deliveriesRoot $KeepVersion
    if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
        $sbomPath = Join-Path $releaseRoot "_manifest/spdx_2.2/manifest.spdx.json"
        if (Test-Path -LiteralPath $sbomPath -PathType Leaf) {
            try {
                $sbom = Get-Content -LiteralPath $sbomPath -Raw -Encoding utf8 | ConvertFrom-Json
                if ([string]$sbom.name -ne "ClassroomToolkit $KeepVersion") {
                    [IO.Directory]::Delete((Join-Path $releaseRoot "_manifest"), $true)
                    $removed.Add((Join-Path $releaseRoot "_manifest"))
                }
            }
            catch {
                Write-Warning "Unable to validate the release SBOM; preserving it: $sbomPath"
            }
        }

        foreach ($item in @(Get-ChildItem -LiteralPath $releaseRoot -Force)) {
            $keep = $item.Name -in @(
                "update-manifest.json",
                "_manifest",
                "ClassroomToolkit-$KeepVersion-win-x64.zip",
                "ClassroomToolkit-$KeepVersion-source.zip"
            )
            if (-not $keep -and $item.Name -match '^ClassroomToolkit-\d+\.\d+\.\d+-(win-x64|source)\.zip$') {
                if ($item.PSIsContainer) {
                    [IO.Directory]::Delete($item.FullName, $true)
                }
                else {
                    [IO.File]::Delete($item.FullName)
                }
                $removed.Add($item.FullName)
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
