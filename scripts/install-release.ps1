#requires -Version 7
param(
    [string]$ManifestUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
    [switch]$RunSetup,
    [switch]$AllowLocalSimulation
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$script:MaximumDownloadBytes = 1GB

# This script is downloaded and run on a machine that has no repository yet, so
# it must stay self-contained: the helpers below intentionally duplicate parts
# of transfer-common.ps1 instead of dot-sourcing it. Do not "deduplicate" them
# into a shared file.
function Assert-ApprovedGitHubUri {
    param(
        [Parameter(Mandatory = $true)][uri]$UriValue,
        [switch]$AllowLocalSimulation
    )

    if ($AllowLocalSimulation -and $UriValue.IsLoopback -and @("http", "https") -contains $UriValue.Scheme.ToLowerInvariant()) {
        return
    }
    # Explicit hosts only: a bare ".githubusercontent.com" suffix would also
    # admit any attacker-registrable subdomain of that zone.
    $allowedHosts = @(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com"
    )
    if ($UriValue.Scheme -ne "https" -or -not ($allowedHosts -contains $UriValue.Host.ToLowerInvariant())) {
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

# One host-validated, size-bounded download core for both release surfaces:
# with -TargetPath it streams an asset that must total exactly -ExactBytes
# (still capped at -MaximumBytes); without it the body returns as UTF-8 text
# capped at -MaximumBytes (the update manifest). HttpClient with redirects
# disabled is used either way because per-hop host validation must not be
# bypassable by following a redirect to an unapproved host.

function Invoke-ApprovedDownload {
    param(
        [Parameter(Mandatory = $true)][uri]$UriValue,
        [long]$MaximumBytes = $script:MaximumDownloadBytes,
        [string]$TargetPath = "",
        [long]$ExactBytes = 0,
        [switch]$AllowLocalSimulation
    )

    if ($TargetPath -and $ExactBytes -le 0) {
        throw "File download requires a positive ExactBytes size: $ExactBytes"
    }
    if (-not $TargetPath -and $ExactBytes -ne 0) {
        throw "Text download does not take ExactBytes."
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
                        throw "Too many or invalid redirects while downloading from $currentUri."
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
                if ($declaredBytes.HasValue) {
                    if ($TargetPath -and $declaredBytes.Value -ne $ExactBytes) {
                        throw "Downloaded asset byte length mismatch. expected=$ExactBytes actual=$($declaredBytes.Value)"
                    }
                    if (-not $TargetPath -and $declaredBytes.Value -gt $MaximumBytes) {
                        throw "Downloaded text exceeds the permitted size: $($declaredBytes.Value) bytes"
                    }
                }

                $source = $null
                $destination = $null
                $memory = $null
                try {
                    $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                    $buffer = [byte[]]::new(131072)
                    [long]$totalBytes = 0
                    if ($TargetPath) {
                        $destination = [IO.File]::Open(
                            $TargetPath,
                            [IO.FileMode]::CreateNew,
                            [IO.FileAccess]::Write,
                            [IO.FileShare]::None)
                        while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                            $totalBytes += $read
                            if ($totalBytes -gt $ExactBytes -or $totalBytes -gt $MaximumBytes) {
                                throw "Downloaded asset exceeds the permitted size."
                            }
                            $destination.Write($buffer, 0, $read)
                        }
                        if ($totalBytes -ne $ExactBytes) {
                            throw "Downloaded asset byte length mismatch. expected=$ExactBytes actual=$totalBytes"
                        }
                    }
                    else {
                        $memory = [IO.MemoryStream]::new()
                        while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                            $totalBytes += $read
                            if ($totalBytes -gt $MaximumBytes) {
                                throw "Downloaded text exceeds the permitted size."
                            }
                            $memory.Write($buffer, 0, $read)
                        }
                        return [Text.Encoding]::UTF8.GetString($memory.ToArray())
                    }
                }
                finally {
                    if ($null -ne $destination) { $destination.Dispose() }
                    if ($null -ne $memory) { $memory.Dispose() }
                    if ($null -ne $source) { $source.Dispose() }
                }
                return
            }
            finally {
                if ($null -ne $response) { $response.Dispose() }
            }
        }
        throw "Too many redirects while downloading from $UriValue."
    }
    catch {
        if ($TargetPath -and (Test-Path -LiteralPath $TargetPath -PathType Leaf)) {
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

$manifestUri = [uri]$ManifestUrl
Assert-ApprovedGitHubUri -UriValue $manifestUri -AllowLocalSimulation:$AllowLocalSimulation

$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-install-{0}" -f [Guid]::NewGuid().ToString("N"))
$downloadRoot = Join-Path $workRoot "downloads"
[IO.Directory]::CreateDirectory($downloadRoot) | Out-Null
$preserveWorkRoot = $false

try {
    $manifestPath = Join-Path $downloadRoot "update-manifest.json"
    # The manifest supplies the publisher thumbprint that the stable channel
    # trusts, so its own redirect chain is host-validated hop by hop and the
    # body is capped before it is trusted.
    $manifestJson = Invoke-ApprovedDownload -UriValue $manifestUri -MaximumBytes 1MB -AllowLocalSimulation:$AllowLocalSimulation
    [IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))
    $manifest = $manifestJson | ConvertFrom-Json
    if ([string]$manifest.schemaVersion -ne "2.0" -or [string]$manifest.kind -ne "classroom-toolkit-update-manifest") {
        throw "Unsupported update manifest."
    }

    # Stable channel: the signed Inno installer owns the real install
    # root and upgrade flow, so only verify the asset and launch it.
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
}
finally {
    if (-not $preserveWorkRoot -and (Test-Path -LiteralPath $workRoot)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
