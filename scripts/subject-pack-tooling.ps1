#requires -Version 7
function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $baseFullPath = [System.IO.Path]::GetFullPath($BasePath)
    if (-not $baseFullPath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFullPath += [System.IO.Path]::DirectorySeparatorChar
    }

    $targetFullPath = [System.IO.Path]::GetFullPath($TargetPath)
    $baseUri = [System.Uri]$baseFullPath
    $targetUri = [System.Uri]$targetFullPath

    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

# Subject pack discovery, ordering, snapshot naming, and eval dataset resolution
# have exactly one implementation: tools/rule-compiler/subject-pack-registry.mjs.
# PowerShell only consumes its JSON output so the two languages cannot drift.
function Get-SubjectPackMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $registryScript = Join-Path $RepositoryRoot "tools/rule-compiler/list-subject-packs.mjs"
    if (-not (Test-Path -LiteralPath $registryScript -PathType Leaf)) {
        throw "Subject pack registry tool not found: $registryScript"
    }

    # stdout is captured alone so a node warning on a healthy run can never
    # corrupt the JSON parse; stderr goes to a temp file for the failure branch.
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("subject-pack-registry-{0}.err" -f [Guid]::NewGuid().ToString("N"))
    try {
        $registryOutput = @(& node $registryScript 2>$stderrPath)
        if ($LASTEXITCODE -ne 0) {
            $diagnostics = if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
                ((Get-Content -LiteralPath $stderrPath -Raw) ?? "").Trim()
            }
            else {
                ""
            }
            throw "Subject pack registry failed with exit code $LASTEXITCODE`: $registryScript`n$diagnostics"
        }
    }
    finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }

    $registryJson = ($registryOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    $packs = @($registryJson | ConvertFrom-Json)
    return @(
        $packs | ForEach-Object {
            [pscustomobject]@{
                AssetId = [string]$_.assetId
                Status = [string]$_.status
                ConfigPath = [string]$_.configPath
                SnapshotPath = [string]$_.snapshotPath
                DefaultProfile = [string]$_.defaultProfile
                Profiles = @($_.profiles)
                EvalDatasetPath = [string]$_.evalDatasetPath
            }
        }
    )
}

function Get-SubjectPackSnapshotOutputPath {
    param(
        [Parameter(Mandatory = $true)]
        $SubjectPack,
        [Parameter(Mandatory = $true)]
        [string]$Profile
    )

    if ([string]$Profile -eq [string]$SubjectPack.DefaultProfile) {
        return [string]$SubjectPack.SnapshotPath
    }

    $snapshotPath = [string]$SubjectPack.SnapshotPath
    $directoryPath = Split-Path -Path $snapshotPath -Parent
    $fileNameWithoutExtension = [System.IO.Path]::GetFileNameWithoutExtension($snapshotPath)
    $extension = [System.IO.Path]::GetExtension($snapshotPath)
    return Join-Path $directoryPath ("{0}.{1}{2}" -f $fileNameWithoutExtension, $Profile, $extension)
}
