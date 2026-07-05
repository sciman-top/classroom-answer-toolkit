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

function Test-DotNetSdkInstalled {
    param(
        [string]$Version
    )

    $sdkOutput = & dotnet --list-sdks
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet --list-sdks failed."
    }

    return @($sdkOutput -split [Environment]::NewLine | Where-Object { $_ -match ('^{0}\s+\[' -f [regex]::Escape($Version)) }).Count -gt 0
}

function Assert-DotNetSdk {
    if (-not (Test-DotNetSdkInstalled -Version "10.0.301")) {
        Write-Host "Installing .NET SDK 10.0.301..."
        & winget install --id Microsoft.DotNet.SDK.10 --exact --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install Microsoft.DotNet.SDK.10."
        }
    }

    if (-not (Test-DotNetSdkInstalled -Version "10.0.301")) {
        throw "Expected .NET SDK 10.0.301 was not found after installation."
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
    Write-Host "Installing Node dependencies for tools/latex-renderer..."
    & npm ci --no-fund --no-audit --prefix tools/latex-renderer
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed for tools/latex-renderer."
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

function Install-PythonOcrEnv {
    $pythonExe = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonExe) {
        $pythonExe = Get-Command py -ErrorAction SilentlyContinue
    }

    if (-not $pythonExe) {
        throw "Python 3.12+ was not found."
    }

    $venvDir = Join-Path $repoRoot "tools\ocr\.venv"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"

    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Host "Creating Python virtual environment for tools/ocr..."
        if ($pythonExe.Source -eq "py") {
            & py -3.12 -m venv tools/ocr/.venv
        } else {
            & python -m venv tools/ocr/.venv
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create tools/ocr/.venv."
        }
    }

    Write-Host "Upgrading Python packaging tools..."
    & $venvPython -m pip install --upgrade pip setuptools wheel
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip tooling."
    }

    Write-Host "Installing Python OCR dependencies..."
    & $venvPython -m pip install -r tools/ocr/requirements.txt
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install tools/ocr requirements."
    }
}

Assert-DotNetSdk
Assert-Browser
Install-NodeDependencies
Compile-RuleSnapshots
Write-Host "Skipping tools/answer-graphics bootstrap; this experimental toolchain is installed on demand."
Install-PythonOcrEnv

Write-Host "Bootstrap complete."
