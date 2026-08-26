$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "subject-pack-tooling.ps1")

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Get-FirstExistingPath {
    param(
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Test-DotNetSdkCompatible {
    param(
        [string]$MinimumVersion
    )

    $sdkOutput = & dotnet --list-sdks
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet --list-sdks failed."
    }

    $minimum = [version]$MinimumVersion
    return @(
        $sdkOutput -split [Environment]::NewLine |
            ForEach-Object {
                if ($_ -match '^(?<version>\d+\.\d+\.\d+)\s+\[') {
                    [version]$Matches.version
                }
            } |
            Where-Object {
                $_.Major -eq $minimum.Major -and
                $_.Minor -eq $minimum.Minor -and
                $_.Build -ge $minimum.Build -and
                $_.Build -lt 400
            }
    ).Count -gt 0
}

function Get-LatestDotNetSdkVersionInBand {
    param(
        [string]$MajorMinor,
        [string]$BandPrefix
    )

    $releases = Invoke-RestMethod -Uri "https://builds.dotnet.microsoft.com/dotnet/release-metadata/$MajorMinor/releases.json"
    return @($releases.releases | ForEach-Object { $_.sdks } | ForEach-Object { $_.version } |
        Where-Object { $_ -like "$BandPrefix.*" })[0]
}

function Assert-DotNetSdk {
    if (-not (Test-DotNetSdkCompatible -MinimumVersion "10.0.300")) {
        Write-Host "Installing a compatible .NET 10.0.3xx SDK..."
        # Unpinned winget may deliver a newer feature band while global.json only
        # rolls forward within 10.0.3xx; resolve and pin the in-band patch instead.
        $targetSdkVersion = Get-LatestDotNetSdkVersionInBand -MajorMinor "10.0" -BandPrefix "10.0.3"
        if ([string]::IsNullOrWhiteSpace($targetSdkVersion)) {
            throw "Unable to resolve the latest .NET 10.0.3xx SDK version from the official release feed."
        }

        & winget install --id Microsoft.DotNet.SDK.10 --exact --version $targetSdkVersion --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) {
            throw ("Failed to install Microsoft.DotNet.SDK.10 {0}; install a 10.0.3xx SDK manually and rerun." -f $targetSdkVersion)
        }
    }

    if (-not (Test-DotNetSdkCompatible -MinimumVersion "10.0.300")) {
        throw "Expected a compatible .NET 10.0.3xx SDK was not found after installation."
    }
}

function Assert-Browser {
    $browserPath = Get-FirstExistingPath @(
        (Join-Path $env:LOCALAPPDATA "Chromium\Application\chrome.exe"),
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )

    if (-not $browserPath) {
        Write-Host "Installing Chromium..."
        & winget install --id Hibbiki.Chromium --exact --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install Chromium."
        }

        $browserPath = Get-FirstExistingPath @(
            (Join-Path $env:LOCALAPPDATA "Chromium\Application\chrome.exe"),
            "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            "C:\Program Files\Google\Chrome\Application\chrome.exe",
            "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
        )
    }

    if (-not $browserPath) {
        throw "No local Chromium, Chrome, or Edge executable found after installation."
    }

    Write-Host "Browser: $browserPath"
}

function Install-NodeDependencies {
    foreach ($toolDirectory in @("tools/latex-renderer", "tools/ai-gateway")) {
        Write-Host "Installing Node dependencies for $toolDirectory..."
        & npm ci --no-fund --no-audit --prefix $toolDirectory
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed for $toolDirectory."
        }
    }
}

function Compile-RuleSnapshots {
    Write-Host "Validating structured prompt assets..."
    & npm --prefix tools/rule-compiler run validate:assets
    if ($LASTEXITCODE -ne 0) {
        throw "Rule compiler asset validation failed."
    }

    $subjectPacks = Get-SubjectPackMetadata -RepositoryRoot $repoRoot
    if ($subjectPacks.Count -eq 0) {
        throw "No subject pack manifests were found under prompts/."
    }

    Write-Host "Compiling discovered subject-pack snapshots..."
    foreach ($subjectPack in $subjectPacks) {
        foreach ($profile in $subjectPack.Profiles) {
            $outputPath = Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile
            $relativeOutputPath = Get-RelativePath -BasePath $repoRoot -TargetPath $outputPath

            Write-Host ("- {0}/{1} -> {2}" -f $subjectPack.AssetId, $profile, $relativeOutputPath)
            & npm --prefix tools/rule-compiler run compile:snapshot -- --subject-pack $subjectPack.AssetId --profile $profile --out $relativeOutputPath
            if ($LASTEXITCODE -ne 0) {
                throw ("Failed to compile snapshot for {0}/{1}." -f $subjectPack.AssetId, $profile)
            }
        }
    }
}

Assert-DotNetSdk
Assert-Browser
Install-NodeDependencies
Compile-RuleSnapshots

Write-Host "Bootstrap complete."
