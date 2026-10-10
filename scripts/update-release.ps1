#requires -Version 7.3
param(
    [Parameter(Mandatory = $true)][uri]$PackageUrl,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes,
    [Parameter(Mandatory = $true)][string]$TargetAppDirectory,
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$RestartExecutable,
    [int]$WaitSeconds = 120,
    [switch]$AllowLocalSimulation,
    [switch]$Simulation
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$script:MaximumDownloadBytes = 1GB

# Runs from inside a downloaded update package after the app has been replaced,
# so it must stay self-contained: Assert-ContainedPath / Assert-ApprovedGitHubUri
# deliberately duplicate transfer-common.ps1 rather than dot-source it.
# The same download/verification logic also lives in scripts/install-release.ps1:
# change all three copies together or the two release surfaces drift.
function Resolve-AbsolutePath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    return [IO.Path]::GetFullPath($PathValue)
}

function Assert-ContainedPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$RootPath
    )
    $root = (Resolve-AbsolutePath $RootPath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $candidate = Resolve-AbsolutePath $PathValue
    if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes root: $candidate"
    }
    return $candidate
}

function Assert-ZipSafe {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )
    Add-Type -AssemblyName System.IO.Compression
    $root = (Resolve-AbsolutePath $DestinationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
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
        throw "Update URL must use an approved GitHub HTTPS host: $UriValue"
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
        throw "Downloaded update exceeds the permitted size: $ExpectedBytes bytes"
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
                        throw "Too many or invalid redirects while downloading update."
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
                    throw "Update byte length mismatch. expected=$ExpectedBytes actual=$($declaredBytes.Value)"
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
                            throw "Downloaded update exceeds the permitted size."
                        }
                        $destination.Write($buffer, 0, $read)
                    }
                    if ($totalBytes -ne $ExpectedBytes) {
                        throw "Update byte length mismatch. expected=$ExpectedBytes actual=$totalBytes"
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
        throw "Too many redirects while downloading update."
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

if ($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw "ExpectedSha256 must be a 64-character SHA-256 value."
}
if ($ExpectedBytes -le 0) {
    throw "ExpectedBytes must be positive."
}
if ($Simulation -and -not $AllowLocalSimulation) {
    throw "-Simulation requires -AllowLocalSimulation."
}
Assert-ApprovedGitHubUri -UriValue $PackageUrl -AllowLocalSimulation:$AllowLocalSimulation

$targetApp = Resolve-AbsolutePath $TargetAppDirectory
$restartPath = Assert-ContainedPath -PathValue $RestartExecutable -RootPath $targetApp
$repoRoot = Resolve-AbsolutePath $RepositoryRoot
$targetParent = [IO.Path]::GetDirectoryName($targetApp)
[IO.Directory]::CreateDirectory($targetParent) | Out-Null
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-update-{0}" -f [Guid]::NewGuid().ToString("N"))
$downloadPath = Join-Path $workRoot "release.zip"
$extractPath = Join-Path $workRoot "extract"
$stagedApp = $extractPath
$backupPath = "$targetApp.backup.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
[IO.Directory]::CreateDirectory($workRoot) | Out-Null

try {
    Write-Host "Downloading update asset..."
    Invoke-ApprovedDownload -UriValue $PackageUrl -TargetPath $downloadPath -ExpectedBytes $ExpectedBytes -AllowLocalSimulation:$AllowLocalSimulation
    $actualBytes = (Get-Item -LiteralPath $downloadPath).Length
    if ($actualBytes -ne $ExpectedBytes) {
        throw "Update byte length mismatch. expected=$ExpectedBytes actual=$actualBytes"
    }
    $actualHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "Update SHA-256 mismatch. expected=$ExpectedSha256 actual=$actualHash"
    }

    Assert-ZipSafe -ZipPath $downloadPath -DestinationRoot $extractPath
    Expand-Archive -LiteralPath $downloadPath -DestinationPath $extractPath -Force
    if (-not (Test-Path -LiteralPath (Join-Path $stagedApp "ClassroomToolkit.App.exe") -PathType Leaf)) {
        throw "Update package does not contain ClassroomToolkit.App.exe."
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        throw "The running application did not exit within $WaitSeconds seconds."
    }

    if (Test-Path -LiteralPath $targetApp) {
        # One sibling backup per update run would accumulate forever; keep the
        # newest recovery point for each kind and report what was pruned.
        foreach ($suffixPrefix in @(".backup.", ".failed.")) {
            $pattern = "$([IO.Path]::GetFileName($targetApp))$suffixPrefix*"
            $staleBackups = @(
                Get-ChildItem -LiteralPath $targetParent -Force -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like $pattern } |
                    Sort-Object -Property LastWriteTimeUtc -Descending |
                    Select-Object -Skip 1
            )
            foreach ($stale in $staleBackups) {
                Write-Host "Removing superseded backup: $($stale.FullName)"
                Remove-Item -LiteralPath $stale.FullName -Recurse -Force
            }
        }
        Move-Item -LiteralPath $targetApp -Destination $backupPath
    }
    Move-Item -LiteralPath $stagedApp -Destination $targetApp

    $smokeStdout = Join-Path $workRoot "replacement-smoke.stdout.log"
    $smokeStderr = Join-Path $workRoot "replacement-smoke.stderr.log"
    $smokeProcess = Start-Process `
        -FilePath $restartPath `
        -ArgumentList @("--smoke", "--repository-root", $repoRoot) `
        -WorkingDirectory $targetApp `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $smokeStdout `
        -RedirectStandardError $smokeStderr
    try {
        if (-not $smokeProcess.WaitForExit(120000)) {
            $smokeProcess.Kill($true)
            throw "Replacement application smoke timed out after 120 seconds."
        }
        if ($smokeProcess.ExitCode -ne 0) {
            $smokeError = if (Test-Path -LiteralPath $smokeStderr) { (Get-Content -LiteralPath $smokeStderr -Raw -Encoding utf8).Trim() } else { "" }
            throw "Replacement application smoke failed with exit code $($smokeProcess.ExitCode): $smokeError"
        }
    }
    finally {
        $smokeProcess.Dispose()
    }

    if ($Simulation) {
        $restartProcess = Start-Process `
            -FilePath $restartPath `
            -ArgumentList @("--smoke", "--repository-root", $repoRoot) `
            -WorkingDirectory $targetApp `
            -WindowStyle Hidden `
            -PassThru
        try {
            if (-not $restartProcess.WaitForExit(120000)) {
                $restartProcess.Kill($true)
                throw "Simulated replacement restart timed out after 120 seconds."
            }
            if ($restartProcess.ExitCode -ne 0) {
                throw "Simulated replacement restart failed with exit code $($restartProcess.ExitCode)."
            }
        }
        finally {
            $restartProcess.Dispose()
        }
    }
    else {
        Start-Process -FilePath $restartPath -WorkingDirectory $targetApp -WindowStyle Hidden | Out-Null
    }
    Write-Host "Update installed; previous app backup: $backupPath"
}
catch {
    if (Test-Path -LiteralPath $backupPath) {
        if (Test-Path -LiteralPath $targetApp) {
            $failedPath = "$targetApp.failed.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
            Move-Item -LiteralPath $targetApp -Destination $failedPath
        }
        Move-Item -LiteralPath $backupPath -Destination $targetApp
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
