#requires -Version 7
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = "1.0.2",
    [string]$DeliveryRoot = "",
    [string]$ReceiptPath = "artifacts\work\verification\release-simulation\release-simulation-receipt.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$deliveryPath = if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) {
    Join-Path $repoRoot "artifacts\deliveries\$Version"
}
else {
    [IO.Path]::GetFullPath($DeliveryRoot)
}
$previewPath = Join-Path $deliveryPath "installer/preview"
$sourcePath = Join-Path $deliveryPath "source"
$receiptPath = Resolve-TransferPath -PathValue $ReceiptPath -BasePath $repoRoot
$simulationRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-release-simulation-{0}" -f [Guid]::NewGuid().ToString("N"))))
$serverRoot = Join-Path $simulationRoot "server"
$serverScriptPath = Join-Path $simulationRoot "loopback-server.ps1"
$serverReadyPath = Join-Path $simulationRoot "server.ready"
$serverStdoutPath = Join-Path $simulationRoot "server.stdout.log"
$serverStderrPath = Join-Path $simulationRoot "server.stderr.log"
$serverProcess = $null
$serverBaseUrl = $null
$failureMessage = $null
$receiptStatus = "failed"
$currentCommit = ""
$sourceDirty = $false
$manifestPath = ""
$scenarios = [Collections.Generic.List[object]]::new()

$serverScript = @'
#requires -Version 7
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$ReadyFile
)

$ErrorActionPreference = "Stop"
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
    $listener.Start()
    [IO.File]::WriteAllText($ReadyFile, "ready", [Text.UTF8Encoding]::new($false))
    while ($true) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            if ($context.Request.HttpMethod -ne "GET") {
                $response.StatusCode = 405
                continue
            }

            $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/')).Replace('/', '\')
            if ([string]::IsNullOrWhiteSpace($relativePath)) {
                $response.StatusCode = 404
                continue
            }
            $candidatePath = [IO.Path]::GetFullPath((Join-Path $Root $relativePath))
            if (-not $candidatePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                continue
            }
            if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
                $response.StatusCode = 404
                continue
            }

            $bytes = [IO.File]::ReadAllBytes($candidatePath)
            $response.StatusCode = 200
            $response.ContentType = if ($candidatePath.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
                'application/json'
            }
            else {
                'application/octet-stream'
            }
            $response.ContentLength64 = $bytes.LongLength
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        catch {
            $response.StatusCode = 500
        }
        finally {
            $response.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
'@

function Add-Scenario {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet("passed", "failed")][string]$Status,
        [Parameter(Mandatory = $true)][string]$Summary
    )

    $scenarios.Add([ordered]@{
        name = $Name
        status = $Status
        summary = $Summary
    })
}

function Invoke-Scenario {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Summary,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    try {
        & $Action
        Add-Scenario -Name $Name -Status "passed" -Summary $Summary
    }
    catch {
        Add-Scenario -Name $Name -Status "failed" -Summary $_.Exception.Message
        throw
    }
}

function Invoke-PwshScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $lines = @(& pwsh -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($lines -join [Environment]::NewLine)
        OutputTail = (($lines | Select-Object -Last 12) -join [Environment]::NewLine)
    }
}

function Assert-Success {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    if ($Result.ExitCode -ne 0) {
        throw "$Operation failed (exit $($Result.ExitCode)): $($Result.OutputTail)"
    }
}

function Assert-ExpectedFailure {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][string]$ExpectedText
    )

    if ($Result.ExitCode -eq 0) {
        throw "$Operation unexpectedly succeeded."
    }
    if ($Result.Output -notmatch [regex]::Escape($ExpectedText)) {
        throw "$Operation failed for an unexpected reason: $($Result.OutputTail)"
    }
}

function Assert-Failure {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    if ($Result.ExitCode -eq 0) {
        throw "$Operation unexpectedly succeeded."
    }
}

function Get-FreeLoopbackPort {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    try {
        return ([Net.IPEndPoint]$probe.LocalEndpoint).Port
    }
    finally {
        $probe.Stop()
    }
}

function Start-LocalServer {
    param([Parameter(Mandatory = $true)]$LocalManifest)

    [IO.Directory]::CreateDirectory($serverRoot) | Out-Null
    $assetLocations = [ordered]@{
        "ClassroomToolkit-$Version-win-x64.zip" = Join-Path $previewPath "ClassroomToolkit-$Version-win-x64.zip"
        "ClassroomToolkit-$Version-source.zip" = Join-Path $sourcePath "ClassroomToolkit-$Version-source.zip"
    }
    foreach ($assetName in $assetLocations.Keys) {
        $assetPath = $assetLocations[$assetName]
        if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
            throw "Delivery asset is missing: $assetPath"
        }
        Copy-Item -LiteralPath $assetPath -Destination (Join-Path $serverRoot $assetName) -Force
    }

    $port = Get-FreeLoopbackPort
    foreach ($asset in @($LocalManifest.assets)) {
        if ($assetLocations.Keys -notcontains [string]$asset.name) {
            throw "Unexpected delivery asset in manifest: $($asset.name)"
        }
        $asset.url = "http://127.0.0.1:$port/$([Uri]::EscapeDataString([string]$asset.name))"
    }
    [IO.File]::WriteAllText(
        (Join-Path $serverRoot "update-manifest.json"),
        (($LocalManifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($serverScriptPath, $serverScript, [Text.UTF8Encoding]::new($false))

    $process = Start-Process -FilePath "pwsh" `
        -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $serverScriptPath,
            "-Root", $serverRoot, "-Port", $port.ToString(), "-ReadyFile", $serverReadyPath) `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $serverStdoutPath `
        -RedirectStandardError $serverStderrPath
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $serverReadyPath -PathType Leaf)) {
        $process.Refresh()
        if ($process.HasExited) {
            $serverError = if (Test-Path -LiteralPath $serverStderrPath) { Get-Content -LiteralPath $serverStderrPath -Raw } else { "" }
            throw "Loopback server exited before readiness: $serverError"
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Loopback server did not become ready within 10 seconds."
        }
        Start-Sleep -Milliseconds 100
    }

    return [pscustomobject]@{
        Process = $process
        BaseUrl = "http://127.0.0.1:$port"
    }
}

function Stop-LocalServer {
    param([Parameter(Mandatory = $true)]$Process)

    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            $Process.WaitForExit(5000) | Out-Null
        }
    }
    finally {
        $Process.Dispose()
    }
}

try {
    $currentCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentCommit)) {
        throw "Unable to resolve the current source commit."
    }
    $sourceDirty = -not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim())
    if ($sourceDirty) {
        throw "Release simulation requires a clean working tree."
    }

    $manifestPath = Join-Path $previewPath "update-manifest.json"
    $appZipPath = Join-Path $previewPath "ClassroomToolkit-$Version-win-x64.zip"
    $sourceZipPath = Join-Path $sourcePath "ClassroomToolkit-$Version-source.zip"
    foreach ($path in @($manifestPath, $appZipPath, $sourceZipPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required delivery file is missing: $path"
        }
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json

    Invoke-Scenario -Name "candidate-binding" -Summary "Current manifest and both delivery assets bind the clean source commit." -Action {
        if ([string]$manifest.version -ne $Version) { throw "Manifest version mismatch: $($manifest.version)" }
        if ([string]$manifest.sourceCommit -ne $currentCommit) { throw "Manifest sourceCommit mismatch." }
        if ([string]$manifest.channel -ne "preview" -or [string]$manifest.audience -ne "developer-operator-preview") {
            throw "Manifest is not the expected preview audience."
        }
        foreach ($asset in @($manifest.assets)) {
            $assetPath = if ([string]$asset.kind -eq "app") {
                Join-Path $previewPath ([string]$asset.name)
            }
            elseif ([string]$asset.kind -eq "source") {
                Join-Path $sourcePath ([string]$asset.name)
            }
            else {
                throw "Unexpected manifest asset kind: $($asset.kind)"
            }
            if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw "Manifest asset is missing: $($asset.name)" }
            if ([string]$asset.sha256 -ne (Get-FileSha256 -PathValue $assetPath)) { throw "Manifest hash mismatch: $($asset.name)" }
            if ([long]$asset.bytes -ne (Get-Item -LiteralPath $assetPath).Length) { throw "Manifest byte mismatch: $($asset.name)" }
        }
    }

    $serverInfo = Start-LocalServer -LocalManifest $manifest
    $serverProcess = $serverInfo.Process
    $serverBaseUrl = $serverInfo.BaseUrl

    $installRoot = Join-Path $simulationRoot "installed"
    Invoke-Scenario -Name "install-empty-destination" -Summary "Installs the verified preview manifest from a loopback source into an empty destination." -Action {
        $result = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/install-release.ps1") -Arguments @(
            "-ManifestUrl", "$serverBaseUrl/update-manifest.json",
            "-Destination", $installRoot,
            "-AllowLocalSimulation")
        Assert-Success -Result $result -Operation "empty-destination install"
        $receipt = Get-Content -LiteralPath (Join-Path $installRoot "install-receipt.json") -Raw -Encoding utf8 | ConvertFrom-Json
        if ([string]$receipt.sourceCommit -ne $currentCommit) { throw "Install receipt sourceCommit mismatch." }
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot "workspace/.env") -PathType Leaf)) { throw "Install did not create .env from .env.example." }
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot "workspace/app/ClassroomToolkit.App.exe") -PathType Leaf)) { throw "Installed app is missing." }
    }

    $occupiedRoot = Join-Path $simulationRoot "occupied-install"
    [IO.Directory]::CreateDirectory($occupiedRoot) | Out-Null
    [IO.File]::WriteAllText((Join-Path $occupiedRoot "operator-marker.txt"), "preserve", [Text.UTF8Encoding]::new($false))
    Invoke-Scenario -Name "install-nonempty-rejection" -Summary "Rejects an occupied destination without deleting its marker." -Action {
        $result = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/install-release.ps1") -Arguments @(
            "-ManifestUrl", "$serverBaseUrl/update-manifest.json",
            "-Destination", $occupiedRoot,
            "-AllowLocalSimulation")
        Assert-ExpectedFailure -Result $result -Operation "occupied-destination install" -ExpectedText "Destination is not empty"
        if (-not (Test-Path -LiteralPath (Join-Path $occupiedRoot "operator-marker.txt") -PathType Leaf)) { throw "Occupied destination marker was removed." }
    }

    $targetApp = Join-Path $installRoot "workspace/app"
    $oldMarker = Join-Path $targetApp "old-release.marker"
    [IO.File]::WriteAllText($oldMarker, "old", [Text.UTF8Encoding]::new($false))
    $appAsset = @($manifest.assets | Where-Object { $_.kind -eq "app" }) | Select-Object -First 1
    $runningProcess = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 2") -WindowStyle Hidden -PassThru
    try {
        Invoke-Scenario -Name "update-success-restart" -Summary "Replaces the app from a loopback asset and completes a simulated smoke restart." -Action {
            $result = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/update-release.ps1") -Arguments @(
                "-PackageUrl", "$serverBaseUrl/$([Uri]::EscapeDataString([string]$appAsset.name))",
                "-ExpectedSha256", [string]$appAsset.sha256,
                "-ExpectedBytes", [string]$appAsset.bytes,
                "-TargetAppDirectory", $targetApp,
                "-RepositoryRoot", $repoRoot,
                "-ProcessId", [string]$runningProcess.Id,
                "-RestartExecutable", (Join-Path $targetApp "ClassroomToolkit.App.exe"),
                "-WaitSeconds", "15",
                "-AllowLocalSimulation",
                "-Simulation")
            Assert-Success -Result $result -Operation "successful simulated update"
            if (Test-Path -LiteralPath $oldMarker -PathType Leaf) { throw "Successful update retained the old app marker." }
            if (-not (Test-Path -LiteralPath (Join-Path $targetApp "ClassroomToolkit.App.exe") -PathType Leaf)) { throw "Updated app is missing." }
        }
    }
    finally {
        $runningProcess.Refresh()
        if (-not $runningProcess.HasExited) { Stop-Process -Id $runningProcess.Id -Force -ErrorAction SilentlyContinue }
        $runningProcess.Dispose()
    }

    $brokenRoot = Join-Path $simulationRoot "broken-update"
    $brokenZip = Join-Path $serverRoot "broken-update.zip"
    [IO.Directory]::CreateDirectory($brokenRoot) | Out-Null
    [IO.File]::WriteAllText((Join-Path $brokenRoot "ClassroomToolkit.App.exe"), "not-a-win32-executable", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $brokenRoot "broken-marker.txt"), "broken", [Text.UTF8Encoding]::new($false))
    Compress-Archive -Path (Join-Path $brokenRoot "*") -DestinationPath $brokenZip -CompressionLevel Fastest
    $brokenHash = Get-FileSha256 -PathValue $brokenZip
    $brokenBytes = (Get-Item -LiteralPath $brokenZip).Length
    $stableMarker = Join-Path $targetApp "stable-release.marker"
    [IO.File]::WriteAllText($stableMarker, "stable", [Text.UTF8Encoding]::new($false))
    $exitedProcess = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", "exit 0") -WindowStyle Hidden -PassThru -Wait
    try {
        Invoke-Scenario -Name "update-failure-rollback" -Summary "Restores the prior app when the replacement executable cannot start." -Action {
            $result = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/update-release.ps1") -Arguments @(
                "-PackageUrl", "$serverBaseUrl/broken-update.zip",
                "-ExpectedSha256", $brokenHash,
                "-ExpectedBytes", [string]$brokenBytes,
                "-TargetAppDirectory", $targetApp,
                "-RepositoryRoot", $repoRoot,
                "-ProcessId", [string]$exitedProcess.Id,
                "-RestartExecutable", (Join-Path $targetApp "ClassroomToolkit.App.exe"),
                "-WaitSeconds", "1",
                "-AllowLocalSimulation",
                "-Simulation")
            Assert-Failure -Result $result -Operation "broken simulated update"
            if (-not (Test-Path -LiteralPath $stableMarker -PathType Leaf)) { throw "Rollback did not restore the stable marker." }
            if (Test-Path -LiteralPath (Join-Path $targetApp "broken-marker.txt") -PathType Leaf) { throw "Broken update remained installed." }
        }
    }
    finally {
        $exitedProcess.Dispose()
    }

    $privatePackage = Join-Path $simulationRoot "private-transfer.zip"
    $privateDestination = Join-Path $simulationRoot "private-import"
    [IO.Directory]::CreateDirectory((Join-Path $privateDestination "workspace")) | Out-Null
    $envSentinel = "SIMULATED_PRIVATE_ENV=preserve-me"
    [IO.File]::WriteAllText((Join-Path $privateDestination "workspace/.env"), $envSentinel + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Invoke-Scenario -Name "private-transfer-preserves-env" -Summary "Exports and imports PrivateDev while preserving an existing .env and excluding Git metadata." -Action {
        $exportResult = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/export-transfer.ps1") -Arguments @(
            "-Mode", "PrivateDev", "-Output", $privatePackage, "-Version", $Version)
        Assert-Success -Result $exportResult -Operation "PrivateDev export"
        if ($exportResult.Output -notmatch "sourceDirty=False") { throw "PrivateDev export was not clean: $($exportResult.OutputTail)" }

        $importResult = Invoke-PwshScript -ScriptPath (Join-Path $repoRoot "scripts/import-transfer.ps1") -Arguments @(
            "-Package", $privatePackage,
            "-Destination", $privateDestination,
            "-AllowExistingDestination",
            "-PreserveExistingEnv")
        Assert-Success -Result $importResult -Operation "PrivateDev import"
        $receipt = Get-Content -LiteralPath (Join-Path $privateDestination "transfer-receipt.json") -Raw -Encoding utf8 | ConvertFrom-Json
        if ([string]$receipt.sourceCommit -ne $currentCommit -or [string]$receipt.mode -ne "PrivateDev") { throw "Transfer receipt binding mismatch." }
        if ([bool]$receipt.envIncluded -or [bool]$receipt.gitIncluded) { throw "PrivateDev receipt includes forbidden material." }
        $actualEnv = Get-Content -LiteralPath (Join-Path $privateDestination "workspace/.env") -Raw -Encoding utf8
        if ($actualEnv -ne ($envSentinel + [Environment]::NewLine)) { throw "Existing .env was not preserved." }
        if (Test-Path -LiteralPath (Join-Path $privateDestination "workspace/.git")) { throw "PrivateDev import unexpectedly contains .git." }
        if (-not (Test-Path -LiteralPath (Join-Path $privateDestination "workspace/scripts/setup-development.ps1") -PathType Leaf)) { throw "Imported setup script is missing." }
    }

    $receiptStatus = "passed"
}
catch {
    $failureMessage = $_.Exception.Message
    $receiptStatus = "failed"
}
finally {
    if ($serverProcess) {
        Stop-LocalServer -Process $serverProcess
        $serverProcess = $null
    }
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $simulationName = [IO.Path]::GetFileName($simulationRoot)
    if ($simulationRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and $simulationName.StartsWith("ClassroomToolkit-release-simulation-", [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $simulationRoot)) {
        [IO.Directory]::Delete($simulationRoot, $true)
    }

    $receipt = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-simulated-acceptance-receipt"
        status = $receiptStatus
        mode = "simulated-acceptance"
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        source = [ordered]@{
            commit = if ($currentCommit) { $currentCommit } else { $null }
            dirty = $sourceDirty
        }
        artifact = [ordered]@{
            version = $Version
            deliveryRoot = $deliveryPath
            manifest = $manifestPath
        }
        simulatedCapabilities = @(
            "loopback verified download",
            "empty and occupied destination install",
            "successful update and smoke restart",
            "replacement failure and rollback",
            "PrivateDev transfer and .env preservation"
        )
        notReplaced = @(
            "publisher identity and Authenticode certificate",
            "GitHub release permissions and external publication",
            "UAC, antivirus, hardware and ordinary-user experience",
            "real provider availability, budget and answer quality",
            "teacher or classroom acceptance"
        )
        scenarios = @($scenarios)
        error = $failureMessage
    }
    Write-JsonFileAtomic -PathValue $receiptPath -Value $receipt
}

if ($failureMessage) {
    throw $failureMessage
}

Write-Host "Simulated release acceptance passed."
Write-Host "Receipt: $receiptPath"
Write-Host "Source commit: $currentCommit"
