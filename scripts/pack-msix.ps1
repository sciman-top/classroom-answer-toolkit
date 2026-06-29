param(
    [string]$PublishDir = "artifacts\publish\ClassroomToolkit.App",
    [string]$StageDir = "artifacts\msix\stage",
    [string]$PackageDir = "artifacts\msix\packages",
    [string]$SmokeReportPath = "",
    [string]$Version = "1.0.0.0",
    [string]$Publisher = "CN=ClassroomToolkit.Dev"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Resolve-RepoPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    return Join-Path $repoRoot $Path
}

function Resolve-SmokeReportPath {
    param(
        [string]$PublishDirPath,
        [string]$ConfiguredPath
    )

    if ([string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        $reportDir = Join-Path $PublishDirPath "..\verification"
        return Join-Path $reportDir ("{0}.smoke-report.json" -f (Split-Path -Path $PublishDirPath -Leaf))
    }

    return Resolve-RepoPath $ConfiguredPath
}

function New-Png {
    param(
        [string]$Path,
        [int]$Width,
        [int]$Height
    )

    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(21, 101, 192))
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $fontSize = [Math]::Max(10, [Math]::Floor($Width / 3))
        $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $rect = New-Object System.Drawing.RectangleF(0, 0, $Width, $Height)
        $graphics.DrawString("CT", $font, $brush, $rect, $format)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Get-MakeAppxPath {
    $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    foreach ($root in $roots) {
        $sdkRoot = Join-Path $root "Windows Kits\10\bin"
        if (-not (Test-Path -LiteralPath $sdkRoot)) {
            continue
        }

        $candidate = Get-ChildItem -LiteralPath $sdkRoot -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1

        if ($candidate) {
            return $candidate.FullName
        }
    }

    return $null
}

$publishDir = Resolve-RepoPath $PublishDir
$stageDir = Resolve-RepoPath $StageDir
$packageDir = Resolve-RepoPath $PackageDir
$smokeReportPath = Resolve-SmokeReportPath -PublishDirPath $publishDir -ConfiguredPath $SmokeReportPath

$exePath = Join-Path $publishDir "ClassroomToolkit.App.exe"
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Published app not found. Run scripts/publish-app.ps1 first. Missing: $exePath"
}

if (-not (Test-Path -LiteralPath $smokeReportPath)) {
    throw "Published smoke report not found. Run scripts/publish-app.ps1 first. Missing: $smokeReportPath"
}

$smokeReport = Get-Content -LiteralPath $smokeReportPath -Raw | ConvertFrom-Json
if ([string]$smokeReport.kind -ne "published-app-smoke-report" -or [string]$smokeReport.status -ne "passed") {
    throw "Published smoke report is invalid or not marked passed."
}

if ([string]::IsNullOrWhiteSpace([string]$smokeReport.smoke.primarySubjectPack)) {
    throw "Published smoke report missing smoke.primarySubjectPack."
}

if ($null -eq $smokeReport.smoke.subjectPacks -or $smokeReport.smoke.subjectPacks.Count -lt 1) {
    throw "Published smoke report missing smoke.subjectPacks."
}

if ([string]::IsNullOrWhiteSpace([string]$smokeReport.smoke.snapshotPath)) {
    throw "Published smoke report missing smoke.snapshotPath."
}

if ([string]::IsNullOrWhiteSpace([string]$smokeReport.diagnostics.manifestPath)) {
    throw "Published smoke report missing diagnostics.manifestPath."
}

$diagnosticManifestPath = [string]$smokeReport.diagnostics.manifestPath
if (-not (Test-Path -LiteralPath $diagnosticManifestPath)) {
    throw "Published smoke diagnostics manifest not found: $diagnosticManifestPath"
}

Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stageDir | Out-Null
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

Copy-Item -Path (Join-Path $publishDir "*") -Destination $stageDir -Recurse -Force

$assetDir = Join-Path $stageDir "Assets"
New-Item -ItemType Directory -Path $assetDir -Force | Out-Null
New-Png -Path (Join-Path $assetDir "StoreLogo.png") -Width 50 -Height 50
New-Png -Path (Join-Path $assetDir "Square44x44Logo.png") -Width 44 -Height 44
New-Png -Path (Join-Path $assetDir "Square150x150Logo.png") -Width 150 -Height 150

$manifestPath = Join-Path $stageDir "AppxManifest.xml"
@"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  IgnorableNamespaces="uap">
  <Identity
    Name="ClassroomToolkit.App"
    Publisher="$Publisher"
    Version="$Version" />
  <Properties>
    <DisplayName>ClassroomToolkit</DisplayName>
    <PublisherDisplayName>ClassroomToolkit</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="zh-CN" />
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="ClassroomToolkitApp" Executable="ClassroomToolkit.App.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="ClassroomToolkit"
        Description="ClassroomToolkit"
        BackgroundColor="#1565C0"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png" />
    </Application>
  </Applications>
</Package>
"@ | Set-Content -LiteralPath $manifestPath -Encoding utf8

$makeAppxPath = Get-MakeAppxPath
$packagePath = Join-Path $packageDir "ClassroomToolkit.App_$Version.msix"
$evidenceDir = Join-Path $packageDir "release-evidence"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$evidenceSmokeReportPath = Join-Path $evidenceDir ("ClassroomToolkit.App_{0}.smoke-report.json" -f $Version)
$evidenceDiagnosticManifestPath = Join-Path $evidenceDir ("ClassroomToolkit.App_{0}.diagnostic-manifest.json" -f $Version)
Copy-Item -LiteralPath $smokeReportPath -Destination $evidenceSmokeReportPath -Force
Copy-Item -LiteralPath $diagnosticManifestPath -Destination $evidenceDiagnosticManifestPath -Force

if ($makeAppxPath) {
    & $makeAppxPath pack /d $stageDir /p $packagePath /overwrite
    if ($LASTEXITCODE -ne 0) {
        throw "makeappx failed."
    }

    Write-Host "MSIX package created: $packagePath"
    Write-Host "Release evidence: $evidenceSmokeReportPath"
} else {
    Write-Host "Windows SDK makeappx.exe not found; MSIX staging prepared without packaging."
    Write-Host "Stage directory: $stageDir"
    Write-Host "Manifest: $manifestPath"
    Write-Host "Release evidence: $evidenceSmokeReportPath"
}
