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
$script:MaximumDownloadBytes = 1GB

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

function Assert-SafeAssetName {
    param([Parameter(Mandatory = $true)][string]$AssetName)

    $unsafe = (
        ([string]::IsNullOrWhiteSpace($AssetName)) -or
        ([IO.Path]::IsPathFullyQualified($AssetName)) -or
        ($AssetName -match '[\\/]') -or
        ($AssetName -in @('.', '..')) -or
        ([IO.Path]::GetFileName($AssetName) -ne $AssetName) -or
        ($AssetName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0)
    )
    if ($unsafe) {
        throw "Asset name must be a safe file basename: $AssetName"
    }
}

function Invoke-ApprovedDownload {
    param(
        [Parameter(Mandatory = $true)][uri]$UriValue,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][long]$ExpectedBytes,
        [switch]$AllowLocalSimulation
    )

    if ($ExpectedBytes -le 0 -or $ExpectedBytes -gt $script:MaximumDownloadBytes) {
        throw "Downloaded asset exceeds the permitted size: $ExpectedBytes bytes"
    }

    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    try {
        $currentUri = $UriValue
        for ($redirect = 0; $redirect -le 5; $redirect++) {
            Assert-ApprovedGitHubUri -UriValue $currentUri -AllowLocalSimulation:$AllowLocalSimulation
            $response = $null
            try {
                $response = $client.GetAsync(
                    $currentUri,
                    [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
                if (@(
                        [Net.HttpStatusCode]::MovedPermanently,
                        [Net.HttpStatusCode]::Found,
                        [Net.HttpStatusCode]::SeeOther,
                        [Net.HttpStatusCode]::TemporaryRedirect,
                        [Net.HttpStatusCode]::PermanentRedirect
                    ) -contains $response.StatusCode) {
                    if ($redirect -ge 5 -or $null -eq $response.Headers.Location) {
                        throw "Too many or invalid redirects while downloading asset."
                    }
                    $currentUri = if ($response.Headers.Location.IsAbsoluteUri) {
                        $response.Headers.Location
                    }
                    else {
                        [uri]::new($currentUri, $response.Headers.Location)
                    }
                    continue
                }

                $response.EnsureSuccessStatusCode()
                $declaredBytes = $response.Content.Headers.ContentLength
                if ($declaredBytes.HasValue -and $declaredBytes.Value -ne $ExpectedBytes) {
                    throw "Downloaded asset byte length mismatch. expected=$ExpectedBytes actual=$($declaredBytes.Value)"
                }

                $source = $null
                $destination = $null
                try {
                    $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                    $destination = [IO.File]::Open(
                        $TargetPath,
                        [IO.FileMode]::CreateNew,
                        [IO.FileAccess]::Write,
                        [IO.FileShare]::None)
                    $buffer = [byte[]]::new(131072)
                    [long]$totalBytes = 0
                    while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $totalBytes += $read
                        if ($totalBytes -gt $ExpectedBytes -or $totalBytes -gt $script:MaximumDownloadBytes) {
                            throw "Downloaded asset exceeds the permitted size."
                        }
                        $destination.Write($buffer, 0, $read)
                    }
                    if ($totalBytes -ne $ExpectedBytes) {
                        throw "Downloaded asset byte length mismatch. expected=$ExpectedBytes actual=$totalBytes"
                    }
                }
                finally {
                    if ($null -ne $destination) { $destination.Dispose() }
                    if ($null -ne $source) { $source.Dispose() }
                }
                return
            }
            finally {
                if ($null -ne $response) { $response.Dispose() }
            }
        }
        throw "Too many redirects while downloading asset."
    }
    catch {
        if (Test-Path -LiteralPath $TargetPath -PathType Leaf) {
            Remove-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue
        }
        throw
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

function Assert-InstallerSignature {
    param(
        [Parameter(Mandatory = $true)][string]$InstallerPath,
        [string]$ExpectedThumbprint,
        [switch]$AllowLocalSimulation
    )

    if ($AllowLocalSimulation) {
        return
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedThumbprint)) {
        throw "Stable update manifest is missing publisherThumbprint."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "Installer Authenticode signature is not valid: $($signature.Status)"
    }
    $actualThumbprint = [string]$signature.SignerCertificate.Thumbprint
    if (-not [string]::Equals(
            ($actualThumbprint -replace '\s', '').ToUpperInvariant(),
            ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant(),
            [StringComparison]::OrdinalIgnoreCase)) {
        throw "Installer publisher thumbprint does not match the stable manifest."
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

    $assetName = [string]$Asset.name
    Assert-SafeAssetName -AssetName $assetName
    $targetPath = Join-Path $DownloadDirectory $assetName
    Invoke-ApprovedDownload -UriValue $uri -TargetPath $targetPath -ExpectedBytes ([long]$Asset.bytes) -AllowLocalSimulation:$AllowLocalSimulation
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

# An explicitly requested destination is validated up front (and by
# -ValidateDestinationOnly) without any network access. The default root's
# emptiness is enforced inside the preview flow after the manifest schema is
# known, so the stable channel can ignore the default location entirely.
$destinationOccupied = (Test-Path -LiteralPath $targetRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $targetRoot -Force).Count -gt 0
if (-not [string]::IsNullOrWhiteSpace($Destination) -and $destinationOccupied) {
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
$preserveWorkRoot = $false

try {
    $manifestPath = Join-Path $downloadRoot "update-manifest.json"
    Invoke-WebRequest -Uri $manifestUri -OutFile $manifestPath -UseBasicParsing
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    $schemaVersion = [string]$manifest.schemaVersion
    if (($schemaVersion -ne "1.0" -and $schemaVersion -ne "2.0") -or [string]$manifest.kind -ne "classroom-toolkit-update-manifest") {
        throw "Unsupported update manifest."
    }
    $workspaceContract = Get-WorkspaceContract -Manifest $manifest

    if ($schemaVersion -eq "2.0") {
        # Stable channel: the signed Inno installer owns the real install
        # root and upgrade flow, so only verify the asset and launch it.
        if (-not [string]::IsNullOrWhiteSpace($Destination)) {
            throw "The stable update manifest manages its own install location; -Destination applies only to the preview workspace manifest."
        }
        $installerAsset = @($manifest.assets | Where-Object { $_.kind -eq "installer" }) | Select-Object -First 1
        if ($null -eq $installerAsset) {
            throw "Stable update manifest must provide an installer asset."
        }
        $installerPath = Download-VerifiedAsset -Asset $installerAsset -DownloadDirectory $downloadRoot -AllowLocalSimulation:$AllowLocalSimulation
        Assert-InstallerSignature -InstallerPath $installerPath -ExpectedThumbprint ([string]$manifest.publisherThumbprint) -AllowLocalSimulation:$AllowLocalSimulation
        $preserveWorkRoot = $true
        if ($RunSetup) {
            Start-Process -FilePath $installerPath -WorkingDirectory $downloadRoot
            Write-Host "Started ClassroomToolkit $($manifest.version) installer: $installerPath"
        }
        else {
            Write-Host "Verified ClassroomToolkit $($manifest.version) installer: $installerPath"
            Write-Host "Run it to install, or rerun with -RunSetup to launch it automatically."
        }
        if ($Launch) {
            Write-Host "The stable installer offers its own post-install launch option; -Launch applies to the preview workspace manifest."
        }
        return
    }

    if ((Test-Path -LiteralPath $targetRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $targetRoot -Force).Count -gt 0) {
        throw "Destination is not empty. Preserve it and use Git/source updates or choose a new destination: $targetRoot"
    }

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
        (($receipt | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
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
    if (-not $preserveWorkRoot -and (Test-Path -LiteralPath $workRoot)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
