#requires -Version 7
param(
    [Parameter(Mandatory = $true)][string]$Package,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$RunSetup,
    [switch]$AllowExistingDestination,
    [switch]$PreserveExistingEnv
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$packagePath = [IO.Path]::GetFullPath($Package)
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Transfer package not found: $packagePath"
}
$destinationPath = [IO.Path]::GetFullPath($Destination)
$destinationParent = [IO.Path]::GetDirectoryName($destinationPath)
[IO.Directory]::CreateDirectory($destinationParent) | Out-Null

if ((Test-Path -LiteralPath $destinationPath) -and @(Get-ChildItem -LiteralPath $destinationPath -Force).Count -gt 0 -and -not $AllowExistingDestination) {
    throw "Destination is not empty. Pass -AllowExistingDestination only after backing it up or confirming the target: $destinationPath"
}

$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-import-{0}" -f [Guid]::NewGuid().ToString("N"))
[IO.Directory]::CreateDirectory($extractRoot) | Out-Null
$backupPath = $null

try {
    Assert-ZipEntriesContained -ZipPath $packagePath -DestinationRoot $extractRoot
    Expand-Archive -LiteralPath $packagePath -DestinationPath $extractRoot -Force
    $manifestPath = Join-Path $extractRoot "transfer-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Transfer manifest is missing from the package."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$manifest.schemaVersion -ne "1.0" -or [string]$manifest.kind -ne "classroom-toolkit-transfer") {
        throw "Unsupported transfer manifest."
    }

    $manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($manifest.files)) {
        $relativePath = ([string]$file.path).Replace("\", "/")
        if ([string]::IsNullOrWhiteSpace($relativePath) -or -not $manifestPaths.Add($relativePath)) {
            throw "Transfer manifest contains an empty or duplicate file path: $relativePath"
        }
        $candidate = Assert-ContainedPath -PathValue (Join-Path $extractRoot $relativePath) -RootPath $extractRoot -Description "manifest file"
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Manifest file is missing: $relativePath"
        }
        $actualBytes = (Get-Item -LiteralPath $candidate).Length
        $actualHash = Get-FileSha256 -PathValue $candidate
        if ([long]$file.bytes -ne $actualBytes -or [string]$file.sha256 -ne $actualHash) {
            throw "Manifest integrity mismatch: $relativePath"
        }
    }

    $actualFiles = @(Get-RelativeFileManifest -RootPath $extractRoot -ExcludeRelativePaths @("transfer-manifest.json"))
    $actualPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $actualFiles) {
        [void]$actualPaths.Add([string]$file.path)
    }
    $missingPaths = @($manifestPaths | Where-Object { -not $actualPaths.Contains($_) })
    $unexpectedPaths = @($actualPaths | Where-Object { -not $manifestPaths.Contains($_) })
    if ($missingPaths.Count -gt 0 -or $unexpectedPaths.Count -gt 0) {
        throw "Transfer manifest file set mismatch. missing=$($missingPaths -join ',') unexpected=$($unexpectedPaths -join ',')"
    }

    $incomingEnv = Join-Path $extractRoot "workspace/.env"
    $existingEnv = Join-Path $destinationPath "workspace/.env"
    if ($PreserveExistingEnv -and (Test-Path -LiteralPath $existingEnv -PathType Leaf)) {
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($incomingEnv)) | Out-Null
        Copy-Item -LiteralPath $existingEnv -Destination $incomingEnv -Force
    }

    if (Test-Path -LiteralPath $destinationPath) {
        $backupPath = "$destinationPath.backup.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
        Move-Item -LiteralPath $destinationPath -Destination $backupPath
    }
    Move-Item -LiteralPath $extractRoot -Destination $destinationPath
    $extractRoot = $null

    $receipt = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-transfer-receipt"
        importedAt = [DateTimeOffset]::UtcNow.ToString("O")
        package = $packagePath
        destination = $destinationPath
        sourceCommit = [string]$manifest.sourceCommit
        mode = [string]$manifest.mode
        envIncluded = [bool]$manifest.envIncluded
        gitIncluded = [bool]$manifest.gitIncluded
        publishedAppIncluded = [bool]$manifest.publishedAppIncluded
        backupPath = $backupPath
        setupRequested = $RunSetup.IsPresent
    }
    Write-JsonFileAtomic -PathValue (Join-Path $destinationPath "transfer-receipt.json") -Value $receipt

    if ($RunSetup) {
        $setupPath = Join-Path $destinationPath "workspace/scripts/setup-development.ps1"
        if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
            throw "Setup script is missing from the imported workspace: $setupPath"
        }
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $setupPath -RepositoryRoot (Join-Path $destinationPath "workspace")
        if ($LASTEXITCODE -ne 0) {
            throw "Imported workspace setup failed."
        }
    }

    Write-Host "Imported transfer package to: $destinationPath"
    if ($backupPath) {
        Write-Host "Previous destination backup: $backupPath"
    }
}
catch {
    if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
        if (Test-Path -LiteralPath $destinationPath) {
            $failedPath = "$destinationPath.failed.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
            Move-Item -LiteralPath $destinationPath -Destination $failedPath
        }
        Move-Item -LiteralPath $backupPath -Destination $destinationPath
    }
    throw
}
finally {
    if ($extractRoot -and (Test-Path -LiteralPath $extractRoot)) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
