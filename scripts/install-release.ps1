#requires -Version 7
param(
    [string]$ManifestUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
    [string]$Destination = "",
    [switch]$RunSetup,
    [switch]$Launch,
    [switch]$ValidateDestinationOnly,
    [switch]$AllowLocalSimulation
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ApprovedGitHubUri {
    param(
        [Parameter(Mandatory = $true)][uri]$UriValue,
        [switch]$AllowLocalSimulation
    )

    if ($AllowLocalSimulation -and $UriValue.IsLoopback -and @("http", "https") -contains $UriValue.Scheme.ToLowerInvariant()) {
        return
    }
    $allowedHosts = @("github.com", "objects.githubusercontent.com")
    if ($UriValue.Scheme -ne "https" -or (-not ($allowedHosts -contains $UriValue.Host.ToLowerInvariant()) -and -not $UriValue.Host.EndsWith(".githubusercontent.com", [StringComparison]::OrdinalIgnoreCase))) {
        throw "URL must use an approved GitHub HTTPS host: $UriValue"
    }
}

function Assert-ZipEntriesContained {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )

    Add-Type -AssemblyName System.IO.Compression
    $root = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if ([IO.Path]::IsPathFullyQualified($entry.FullName) -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)') {
                throw "Unsafe archive entry: $($entry.FullName)"
            }
            $candidate = [IO.Path]::GetFullPath((Join-Path $DestinationRoot $entry.FullName))
            if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Archive entry escapes destination: $($entry.FullName)"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Download-VerifiedAsset {
    param(
        [Parameter(Mandatory = $true)]$Asset,
        [Parameter(Mandatory = $true)][string]$DownloadDirectory,
        [switch]$AllowLocalSimulation
    )

    $uri = [uri][string]$Asset.url
    Assert-ApprovedGitHubUri -UriValue $uri -AllowLocalSimulation:$AllowLocalSimulation
    $expectedHash = [string]$Asset.sha256
    if ($expectedHash -notmatch '^[A-Fa-f0-9]{64}$') {
        throw "Asset SHA-256 is invalid: $($Asset.name)"
    }
    if ([long]$Asset.bytes -le 0) {
        throw "Asset byte length is invalid: $($Asset.name)"
    }

    $targetPath = Join-Path $DownloadDirectory ([string]$Asset.name)
    Invoke-WebRequest -Uri $uri -OutFile $targetPath -UseBasicParsing
    $actualBytes = (Get-Item -LiteralPath $targetPath).Length
    $actualHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualBytes -ne [long]$Asset.bytes -or $actualHash -ne $expectedHash.ToLowerInvariant()) {
        throw "Downloaded asset integrity mismatch: $($Asset.name)"
    }
    return $targetPath
}

function Get-WorkspaceContract {
    param([Parameter(Mandatory = $true)]$Manifest)

    $workspaceContract = [string]$Manifest.workspaceContract
    if ([string]::IsNullOrWhiteSpace($workspaceContract)) {
        return "1"
    }
    if ($workspaceContract -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw "Workspace contract is invalid: $workspaceContract"
    }
    return $workspaceContract
}

$manifestUri = [uri]$ManifestUrl
Assert-ApprovedGitHubUri -UriValue $manifestUri -AllowLocalSimulation:$AllowLocalSimulation
$targetRoot = if ([string]::IsNullOrWhiteSpace($Destination)) {
    Join-Path $env:LOCALAPPDATA "ClassroomToolkit"
}
else {
    [IO.Path]::GetFullPath($Destination)
}

if ((Test-Path -LiteralPath $targetRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $targetRoot -Force).Count -gt 0) {
    throw "Destination is not empty. Preserve it and use Git/source updates or choose a new destination: $targetRoot"
}
if ($ValidateDestinationOnly) {
    Write-Host "Install destination is available: $targetRoot"
    return
}

$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-install-{0}" -f [Guid]::NewGuid().ToString("N"))
$downloadRoot = Join-Path $workRoot "downloads"
$stageRoot = Join-Path $workRoot "stage"
[IO.Directory]::CreateDirectory($downloadRoot) | Out-Null
[IO.Directory]::CreateDirectory($stageRoot) | Out-Null

try {
    $manifestPath = Join-Path $downloadRoot "update-manifest.json"
    Invoke-WebRequest -Uri $manifestUri -OutFile $manifestPath -UseBasicParsing
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$manifest.schemaVersion -ne "1.0" -or [string]$manifest.kind -ne "classroom-toolkit-update-manifest") {
        throw "Unsupported update manifest."
    }
    $workspaceContract = Get-WorkspaceContract -Manifest $manifest

    $appAsset = @($manifest.assets | Where-Object { $_.kind -eq "app" }) | Select-Object -First 1
    $sourceAsset = @($manifest.assets | Where-Object { $_.kind -eq "source" }) | Select-Object -First 1
    if ($null -eq $appAsset -or $null -eq $sourceAsset) {
        throw "Update manifest must provide both app and source assets."
    }

    $appZip = Download-VerifiedAsset -Asset $appAsset -DownloadDirectory $downloadRoot -AllowLocalSimulation:$AllowLocalSimulation
    $sourceZip = Download-VerifiedAsset -Asset $sourceAsset -DownloadDirectory $downloadRoot -AllowLocalSimulation:$AllowLocalSimulation
    $workspaceStage = Join-Path $stageRoot "workspace"
    [IO.Directory]::CreateDirectory($workspaceStage) | Out-Null
    Assert-ZipEntriesContained -ZipPath $sourceZip -DestinationRoot $workspaceStage
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $workspaceStage -Force
    $appStage = Join-Path $workspaceStage "app"
    [IO.Directory]::CreateDirectory($appStage) | Out-Null
    Assert-ZipEntriesContained -ZipPath $appZip -DestinationRoot $appStage
    Expand-Archive -LiteralPath $appZip -DestinationPath $appStage -Force
    if (-not (Test-Path -LiteralPath (Join-Path $appStage "ClassroomToolkit.App.exe") -PathType Leaf)) {
        throw "The verified app asset does not contain ClassroomToolkit.App.exe."
    }

    $envTemplate = Join-Path $workspaceStage ".env.example"
    if (Test-Path -LiteralPath $envTemplate -PathType Leaf) {
        Copy-Item -LiteralPath $envTemplate -Destination (Join-Path $workspaceStage ".env")
    }

    [IO.Directory]::CreateDirectory($targetRoot) | Out-Null
    Move-Item -LiteralPath $workspaceStage -Destination (Join-Path $targetRoot "workspace")
    $receipt = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-install-receipt"
        installedAt = [DateTimeOffset]::UtcNow.ToString("O")
        version = [string]$manifest.version
        sourceCommit = [string]$manifest.sourceCommit
        workspaceContract = $workspaceContract
        manifestUrl = $manifestUri.AbsoluteUri
        setupRequested = $RunSetup.IsPresent
    }
    [IO.File]::WriteAllText(
        (Join-Path $targetRoot "install-receipt.json"),
        (($receipt | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))

    $workspaceRoot = Join-Path $targetRoot "workspace"
    if ($RunSetup) {
        $setupPath = Join-Path $workspaceRoot "scripts/setup-development.ps1"
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $setupPath -RepositoryRoot $workspaceRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Initial development setup failed. The extracted workspace remains at $workspaceRoot for diagnosis."
        }
    }

    Write-Host "Installed ClassroomToolkit $($manifest.version) to: $targetRoot"
    Write-Host "The local .env was created from .env.example with cloud egress disabled."
    if ($Launch) {
        Start-Process -FilePath (Join-Path $workspaceRoot "app/ClassroomToolkit.App.exe") -WorkingDirectory (Join-Path $workspaceRoot "app")
    }
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
