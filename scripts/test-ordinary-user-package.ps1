#requires -Version 7.3
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
    param([string]$Name, [string]$Status, [string]$Summary, [object]$Artifacts = $null)
    $scenario = [ordered]@{ name = $Name; status = $Status; summary = $Summary }
    if ($null -ne $Artifacts) {
        $scenario.artifacts = $Artifacts
    }
    $scenarios.Add($scenario)
}

function Invoke-Scenario {
    param([string]$Name, [string]$Summary, [scriptblock]$Action)
    try {
        $result = & $Action
        $artifacts = if ($result -is [Collections.IDictionary]) { $result } else { $null }
        Add-Scenario -Name $Name -Status "passed" -Summary $Summary -Artifacts $artifacts
    }
    catch {
        Add-Scenario -Name $Name -Status "failed" -Summary $_.Exception.Message
        throw
    }
}

# Start-Process -Wait has no timeout: a hung app or installer would block the
# acceptance run forever. smoke-installed-app.ps1 already bounds its wait.
$script:ProcessTimeoutSeconds = 600

function Wait-ProcessBounded {
    param(
        [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$Description,
        [int]$TimeoutSeconds = $script:ProcessTimeoutSeconds
    )

    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try {
            $Process.Kill($true)
        }
        catch {
            # Best effort: the timeout below still fails the scenario.
        }
        throw "$Description did not exit within $TimeoutSeconds seconds and was terminated."
    }
    # Flush the asynchronous redirected-output readers before the caller reads
    # the log files, otherwise the tail of the output can be missing.
    $Process.WaitForExit()
    return $Process.ExitCode
}

function Invoke-AppSmoke {
    param([Parameter(Mandatory = $true)][string]$Root)

    $stdout = Join-Path $testRoot ("smoke-{0}.stdout.log" -f [Guid]::NewGuid().ToString("N"))
    $stderr = Join-Path $testRoot ("smoke-{0}.stderr.log" -f [Guid]::NewGuid().ToString("N"))
    $process = Start-Process -FilePath (Join-Path $Root "ClassroomToolkit.App.exe") `
        -ArgumentList @("--smoke", "--repository-root", ('"{0}"' -f $Root)) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    $exitCode = Wait-ProcessBounded -Process $process -Description "Application smoke"
    $output = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { "" }
    $errorOutput = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { "" }
    if ($exitCode -ne 0 -or $output -notmatch "workspaceHealthy=True") {
        throw "Application smoke failed (exit $exitCode): $output $errorOutput"
    }
}

function Invoke-RendererSmoke {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][ValidateSet("installer", "portable")][string]$Distribution
    )

    $nodePath = Join-Path $Root "runtime/node/node.exe"
    $rendererPath = Join-Path $Root "tools/latex-renderer/deliver-answer.mjs"
    $snapshotPath = Join-Path $Root ".snapshot-cache/resolved-snapshot.json"
    foreach ($requiredPath in @($nodePath, $rendererPath, $snapshotPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Packaged renderer input is missing: $requiredPath"
        }
    }

    $smokeRoot = Join-Path $testRoot "renderer-$Distribution"
    [IO.Directory]::CreateDirectory($smokeRoot) | Out-Null
    $markdownPath = Join-Path $smokeRoot "renderer-smoke.md"
    $pdfPath = Join-Path $smokeRoot "renderer-smoke.pdf"
    $deliveryManifestPath = Join-Path $smokeRoot "renderer-smoke.delivery-manifest.json"
    $sampleMarkdown = @'
# 渲染冒烟

固定的无 AI 样例用于检查答案 PDF 交付链。

合力满足 $F=ma。
'@
    [IO.File]::WriteAllText(
        $markdownPath,
        $sampleMarkdown,
        [Text.UTF8Encoding]::new($false))

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodePath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment["INIT_CWD"] = $Root
    [void]$startInfo.Environment.Remove("CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT")
    foreach ($argument in @(
        $rendererPath,
        $markdownPath,
        $pdfPath,
        "--subject-pack", "junior-physics-answer",
        "--snapshot-path", $snapshotPath,
        "--keep-review")) {
        $startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Unable to start bundled Node.js for the $Distribution PDF smoke."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($script:ProcessTimeoutSeconds * 1000)) {
        try { $process.Kill($true) } catch { }
        throw "Bundled $Distribution PDF render did not exit within $script:ProcessTimeoutSeconds seconds."
    }
    $process.WaitForExit()
    $output = $stdoutTask.GetAwaiter().GetResult()
    $errorOutput = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        throw "Bundled $Distribution PDF render failed (exit $($process.ExitCode)): $output $errorOutput"
    }
    if (-not (Test-Path -LiteralPath $pdfPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $deliveryManifestPath -PathType Leaf)) {
        throw "Bundled $Distribution PDF render did not create both the PDF and delivery manifest. $output $errorOutput"
    }

    $pdfInfo = Get-Item -LiteralPath $pdfPath
    if ($pdfInfo.Length -lt 1024) {
        throw "Bundled $Distribution PDF output is unexpectedly small: $($pdfInfo.Length) bytes."
    }
    $pdfHeader = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdfPath), 0, 5)
    if ($pdfHeader -ne "%PDF-") {
        throw "Bundled $Distribution renderer output is not a PDF file."
    }
    $deliveryManifest = Get-Content -LiteralPath $deliveryManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$deliveryManifest.schemaVersion -ne "1.1" -or
        $deliveryManifest.status.deliveryComplete -ne $true -or
        [string]$deliveryManifest.integrity.algorithm -ne "sha256") {
        throw "Bundled $Distribution renderer produced an incomplete or unsupported delivery manifest."
    }
    $pdfSha256 = Get-FileSha256 -PathValue $pdfPath
    if ([string]$deliveryManifest.integrity.output.sha256 -ne $pdfSha256 -or
        [long]$deliveryManifest.integrity.output.bytes -ne $pdfInfo.Length) {
        throw "Bundled $Distribution delivery manifest does not match its PDF output."
    }

    return [ordered]@{
        pdfSha256 = $pdfSha256
        pdfBytes = $pdfInfo.Length
        deliveryManifestSha256 = Get-FileSha256 -PathValue $deliveryManifestPath
        deliveryManifestSchemaVersion = [string]$deliveryManifest.schemaVersion
    }
}

function Invoke-Setup {
    param([Parameter(Mandatory = $true)][string]$LogName)

    $logPath = Join-Path $testRoot $LogName
    $process = Start-Process -FilePath $setupPath `
        -ArgumentList @(
            "/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
            ('/DIR="{0}"' -f $installRoot), ('/LOG="{0}"' -f $logPath)) `
        -WindowStyle Hidden `
        -PassThru
    $exitCode = Wait-ProcessBounded -Process $process -Description "Installer"
    if ($exitCode -ne 0) {
        throw "Installer failed (exit $exitCode); log: $logPath"
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
        if ([string]$manifest.schemaVersion -ne "1.0" -or [string]$manifest.kind -ne "classroom-toolkit-install-manifest") { throw "Unsupported install manifest contract." }
        if ([string]$manifest.version -ne $Version) { throw "Install manifest version mismatch." }
        foreach ($kind in @("installer", "portable")) {
            if (@($manifest.assets | Where-Object { $_.kind -eq $kind }).Count -ne 1) {
                throw "Install manifest must contain exactly one $kind asset."
            }
        }
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
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot ".env") -PathType Leaf)) { throw "Seeded .env template is missing." }
        Invoke-AppSmoke -Root $installRoot
        Invoke-RendererSmoke -Root $installRoot -Distribution "installer"
    }

    Invoke-Scenario -Name "installer-repair" -Summary "Rerunning setup restores a missing packaged file, preserves the configured .env, and keeps install viability." -Action {
        # The seeded .env is the teacher's configuration carrier: a repair (or
        # upgrade) rerun must never overwrite a configured key file.
        $envPath = Join-Path $installRoot ".env"
        Set-Content -LiteralPath $envPath -Value "CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY=teacher-acceptance-key" -Encoding utf8
        $noticePath = Join-Path $installRoot "LICENSE.txt"
        Remove-Item -LiteralPath $noticePath -Force
        Invoke-Setup -LogName "repair.log"
        if (-not (Test-Path -LiteralPath $noticePath -PathType Leaf)) { throw "Repair did not restore LICENSE.txt." }
        if ((Get-Content -LiteralPath $envPath -Raw) -notmatch "teacher-acceptance-key") { throw "Repair overwrote the configured .env." }
        Invoke-AppSmoke -Root $installRoot
    }

    Invoke-Scenario -Name "portable-launch" -Summary "Portable ZIP runs after extraction with no installer or external toolchain." -Action {
        Expand-Archive -LiteralPath $portablePath -DestinationPath $portableRoot -Force
        $runtimeManifest = Get-Content -LiteralPath (Join-Path $portableRoot "runtime-manifest.json") -Raw | ConvertFrom-Json
        if ([string]$runtimeManifest.distributionMode -ne "portable") { throw "Portable runtime mode is not portable." }
        Invoke-AppSmoke -Root $portableRoot
        Invoke-RendererSmoke -Root $portableRoot -Distribution "portable"
    }

    Invoke-Scenario -Name "installer-uninstall" -Summary "The registered uninstaller removes the application executable." -Action {
        $uninstaller = Join-Path $installRoot "unins000.exe"
        if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Uninstaller is missing." }
        # Bounded wait like every other scenario: a hung uninstaller (e.g. a
        # suppressed CloseApplications dialog that still blocks) must fail the
        # run, not block it forever.
        $process = Start-Process -FilePath $uninstaller `
            -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART") `
            -WindowStyle Hidden `
            -PassThru
        [void](Wait-ProcessBounded -Process $process -Description "uninstaller")
        if ($process.ExitCode -ne 0) { throw "Uninstaller failed (exit $($process.ExitCode))." }
        if (Test-Path -LiteralPath (Join-Path $installRoot "ClassroomToolkit.App.exe") -PathType Leaf) { throw "Application executable remains after uninstall." }
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot ".env") -PathType Leaf)) { throw "Teacher .env must survive uninstall." }
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
        evidenceBoundary = "local Windows install/repair/uninstall, packaged PDF rendering and delivery-manifest integrity; not representative human acceptance"
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
