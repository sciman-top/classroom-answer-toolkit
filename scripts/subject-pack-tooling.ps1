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

function Resolve-SubjectPackSnapshotPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot,
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath,
        [Parameter()]
        $Config
    )

    if ($null -ne $Config -and $null -ne $Config.snapshot -and -not [string]::IsNullOrWhiteSpace([string]$Config.snapshot.cachePath)) {
        return [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $ConfigPath -Parent) ([string]$Config.snapshot.cachePath)))
    }

    return Join-Path $RepositoryRoot ".snapshot-cache\resolved-snapshot.json"
}

function Get-SubjectPackMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $promptsRoot = Join-Path $RepositoryRoot "prompts"
    if (-not (Test-Path -LiteralPath $promptsRoot)) {
        return @()
    }

    $subjectPacks = foreach ($manifestFile in Get-ChildItem -Path $promptsRoot -Filter manifest.json -Recurse -File) {
        $manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
        if ($null -eq $manifest -or [string]$manifest.kind -ne "subject-pack" -or [string]::IsNullOrWhiteSpace([string]$manifest.assetId)) {
            continue
        }

        $packRoot = Split-Path -Path $manifestFile.FullName -Parent
        $configRelativePath = if ($null -ne $manifest.sourceOfTruth -and -not [string]::IsNullOrWhiteSpace([string]$manifest.sourceOfTruth.runtimeConfig)) {
            [string]$manifest.sourceOfTruth.runtimeConfig
        } else {
            ".\config.json"
        }

        $configPath = [System.IO.Path]::GetFullPath((Join-Path $packRoot $configRelativePath))
        $config = if (Test-Path -LiteralPath $configPath) {
            Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        } else {
            $null
        }

        $defaultProfile = if ($null -ne $config -and $null -ne $config.profiles -and -not [string]::IsNullOrWhiteSpace([string]$config.profiles.default)) {
            [string]$config.profiles.default
        } else {
            "classroom"
        }

        $profileNames = if ($null -ne $config -and $null -ne $config.profiles) {
            @($config.profiles.PSObject.Properties.Name | Where-Object { $_ -ne "default" })
        } else {
            @()
        }

        if ($profileNames.Count -eq 0) {
            $profileNames = @($defaultProfile)
        } elseif ($profileNames -contains $defaultProfile) {
            $profileNames = @($defaultProfile) + @($profileNames | Where-Object { $_ -ne $defaultProfile })
        } else {
            $profileNames = @($defaultProfile) + $profileNames
        }

        $evalDatasetPath = if ($null -ne $config -and $null -ne $config.evaluation -and -not [string]::IsNullOrWhiteSpace([string]$config.evaluation.dataset)) {
            [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $configPath -Parent) ([string]$config.evaluation.dataset)))
        } else {
            Join-Path $RepositoryRoot ("eval\{0}\dataset.json" -f [string]$manifest.assetId)
        }

        [pscustomobject]@{
            AssetId = [string]$manifest.assetId
            Status = if ($null -ne $manifest.status) { [string]$manifest.status } else { "" }
            ConfigPath = $configPath
            SnapshotPath = Resolve-SubjectPackSnapshotPath -RepositoryRoot $RepositoryRoot -ConfigPath $configPath -Config $config
            DefaultProfile = $defaultProfile
            Profiles = $profileNames
            EvalDatasetPath = $evalDatasetPath
        }
    }

    return @(
        $subjectPacks |
            Sort-Object `
                @{ Expression = { [string]$_.Status -ne "active" } }, `
                @{ Expression = { [string]$_.AssetId -ne "physics-answer" } }, `
                @{ Expression = { [string]$_.AssetId } }
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
