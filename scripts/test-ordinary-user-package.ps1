#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$DeliveryRoot = "",
    [string]$ReceiptPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$versionRoot = if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) {
    Join-Path $repoRoot "artifacts/deliveries/$Version"
}
else {
    [IO.Path]::GetFullPath($DeliveryRoot)
}
$receiptPath = if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    Join-Path $repoRoot "artifacts/work/installer/ordinary-user-acceptance.json"
}
else {
    [IO.Path]::GetFullPath($ReceiptPath)
}
$setupPath = Join-Path $versionRoot "installer/stable/ClassroomToolkit-$Version-setup.exe"
$portablePath = Join-Path $versionRoot "portable/ClassroomToolkit-$Version-portable-win-x64.zip"
$installManifestPath = Join-Path $versionRoot "installer/stable/install-manifest.json"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-ordinary-acceptance-{0}" -f [Guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $testRoot "installed"
$portableRoot = Join-Path $testRoot "portable"
$scenarios = [Collections.Generic.List[object]]::new()
$failureMessage = $null

# Inno Setup does not create the parent directory for /LOG itself. Create the
# acceptance workspace before invoking setup so a missing log directory cannot
# turn an otherwise valid install into a false-negative exit code.
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

function Add-Scenario {
    param([string]$Name, [string]$Status, [string]$Summary)
    $scenarios.Add([ordered]@{ name = $Name; status = $Status; summary = $Summary })
}

function Invoke-Scenario {
    param([string]$Name, [string]$Summary, [scriptblock]$Action)
    try {
        & $Action
        Add-Scenario -Name $Name -Status "passed" -Summary $Summary
    }
    catch {
        Add-Scenario -Name $Name -Status "failed" -Summary $_.Exception.Message
        throw
    }
}

function Invoke-AppSmoke {
    param([Parameter(Mandatory = $true)][string]$Root)

    $stdout = Join-Path $testRoot ("smoke-{0}.stdout.log" -f [Guid]::NewGuid().ToString("N"))
    $stderr = Join-Path $testRoot ("smoke-{0}.stderr.log" -f [Guid]::NewGuid().ToString("N"))
    $process = Start-Process -FilePath (Join-Path $Root "ClassroomToolkit.App.exe") `
        -ArgumentList @("--smoke", "--repository-root", $Root) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -Wait `
        -PassThru
    $output = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { "" }
    $errorOutput = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { "" }
    if ($process.ExitCode -ne 0 -or $output -notmatch "workspaceHealthy=True") {
        throw "Application smoke failed (exit $($process.ExitCode)): $output $errorOutput"
    }
}

function Invoke-Setup {
    param([Parameter(Mandatory = $true)][string]$LogName)

    $logPath = Join-Path $testRoot $LogName
    $process = Start-Process -FilePath $setupPath `
        -ArgumentList @(
            "/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
            "/DIR=$installRoot", "/LOG=$logPath") `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Installer failed (exit $($process.ExitCode)); log: $logPath"
    }
}

try {
    foreach ($path in @($setupPath, $portablePath, $installManifestPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required ordinary-user artifact is missing: $path"
        }
    }
    $manifest = Get-Content -LiteralPath $installManifestPath -Raw -Encoding utf8 | ConvertFrom-Json

    Invoke-Scenario -Name "artifact-integrity" -Summary "Installer and portable archive match the install manifest." -Action {
        foreach ($asset in @($manifest.assets | Where-Object { $_.kind -in @("installer", "portable") })) {
            $assetPath = if ($asset.kind -eq "installer") { $setupPath } else { $portablePath }
            if ([string]$asset.sha256 -ne (Get-FileSha256 -PathValue $assetPath)) { throw "SHA-256 mismatch: $($asset.name)" }
            if ([long]$asset.bytes -ne (Get-Item -LiteralPath $assetPath).Length) { throw "Byte length mismatch: $($asset.name)" }
        }
    }

    Invoke-Scenario -Name "installer-clean-install" -Summary "Setup installs the bundled runtime without administrator input and the app passes isolated smoke." -Action {
        Invoke-Setup -LogName "install.log"
        $runtimeManifest = Get-Content -LiteralPath (Join-Path $installRoot "runtime-manifest.json") -Raw | ConvertFrom-Json
        if ([string]$runtimeManifest.distributionMode -ne "installer") { throw "Installed runtime mode is not installer." }
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot "runtime/node/node.exe") -PathType Leaf)) { throw "Bundled Node.js is missing." }
        Invoke-AppSmoke -Root $installRoot
    }

    Invoke-Scenario -Name "installer-repair" -Summary "Rerunning setup restores a missing packaged file and preserves install viability." -Action {
        $noticePath = Join-Path $installRoot "LICENSE.txt"
        Remove-Item -LiteralPath $noticePath -Force
        Invoke-Setup -LogName "repair.log"
        if (-not (Test-Path -LiteralPath $noticePath -PathType Leaf)) { throw "Repair did not restore LICENSE.txt." }
        Invoke-AppSmoke -Root $installRoot
    }

    Invoke-Scenario -Name "portable-launch" -Summary "Portable ZIP runs after extraction with no installer or external toolchain." -Action {
        Expand-Archive -LiteralPath $portablePath -DestinationPath $portableRoot -Force
        $runtimeManifest = Get-Content -LiteralPath (Join-Path $portableRoot "runtime-manifest.json") -Raw | ConvertFrom-Json
        if ([string]$runtimeManifest.distributionMode -ne "portable") { throw "Portable runtime mode is not portable." }
        Invoke-AppSmoke -Root $portableRoot
    }

    Invoke-Scenario -Name "installer-uninstall" -Summary "The registered uninstaller removes the application executable." -Action {
        $uninstaller = Join-Path $installRoot "unins000.exe"
        if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Uninstaller is missing." }
        $process = Start-Process -FilePath $uninstaller `
            -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART") `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstaller failed (exit $($process.ExitCode))." }
        if (Test-Path -LiteralPath (Join-Path $installRoot "ClassroomToolkit.App.exe") -PathType Leaf) { throw "Application executable remains after uninstall." }
    }
}
catch {
    $failureMessage = $_.Exception.Message
}
finally {
    $receipt = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-ordinary-user-package-acceptance"
        status = if ($failureMessage) { "failed" } else { "passed" }
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        version = $Version
        deliveryRoot = $versionRoot
        signatureStatus = if (Test-Path -LiteralPath $setupPath -PathType Leaf) { [string](Get-AuthenticodeSignature -LiteralPath $setupPath).Status } else { $null }
        evidenceBoundary = "local Windows install/repair/uninstall and portable smoke; not publisher or representative human acceptance"
        scenarios = @($scenarios)
        error = $failureMessage
    }
    Write-JsonFileAtomic -PathValue $receiptPath -Value $receipt
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($failureMessage) {
    throw $failureMessage
}

Write-Host "Ordinary-user package acceptance passed."
Write-Host "Receipt: $receiptPath"
