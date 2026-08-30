#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$WorkspaceContract = "2",
    [string]$OutputDirectory = "artifacts\deliveries",
    [string]$IsccPath = "",
    [string]$SigningCertificateThumbprint = "",
    [string]$TimestampServer = "http://timestamp.digicert.com",
    [switch]$SkipPublish,
    [switch]$AllowUnsignedCandidate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputParent = Resolve-TransferPath -PathValue $OutputDirectory -BasePath $repoRoot
$outputRoot = Join-Path $outputParent $Version
$stableRoot = Join-Path $outputRoot "installer/stable"
$portableRoot = Join-Path $outputRoot "portable"
$sourceRoot = Join-Path $outputRoot "source"
$publishRoot = Join-Path $repoRoot "artifacts/work/publish/ClassroomToolkit.App"
$smokeReportPath = Join-Path $repoRoot "artifacts/work/publish/verification/ClassroomToolkit.App.smoke-report.json"
$dependencyPath = Join-Path $PSScriptRoot "installer/runtime-dependencies.json"
$innoSourcePath = Join-Path $PSScriptRoot "installer/ClassroomToolkit.iss"
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-ordinary-package-{0}" -f [Guid]::NewGuid().ToString("N"))
$stageRoot = Join-Path $workRoot "runtime"
$nodeExtractRoot = Join-Path $workRoot "node"
$currentCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())

function Resolve-IsccPath {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $resolved = [IO.Path]::GetFullPath($RequestedPath)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Inno Setup compiler was not found: $resolved"
        }
        return $resolved
    }

    $command = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs/Inno Setup 6/ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6/ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6/ISCC.exe")
    )
    $match = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $match) {
        throw "Inno Setup 6 compiler was not found. Install JRSoftware.InnoSetup or pass -IsccPath."
    }
    return [IO.Path]::GetFullPath($match)
}

function Copy-PublishNotices {
    param([Parameter(Mandatory = $true)][string]$DestinationDirectory)

    Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $DestinationDirectory "LICENSE.txt") -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $DestinationDirectory "THIRD_PARTY_NOTICES.md") -Force
}

function Write-RuntimeManifest {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("installer", "portable")][string]$DistributionMode,
        $Certificate
    )

    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-runtime"
        version = $Version
        sourceCommit = $currentCommit
        workspaceContract = $WorkspaceContract
        distributionMode = $DistributionMode
        publisherThumbprint = if ($Certificate) { $Certificate.Thumbprint } else { $null }
        runtime = [ordered]@{
            nodeVersion = [string]$dependencies.node.version
            nodeArchiveSha256 = [string]$dependencies.node.sha256
            browser = "installed Microsoft Edge or Google Chrome"
        }
        capabilities = @(
            "launch without Git, PowerShell, .NET SDK or system Node.js",
            "validate and render answer Markdown",
            "write PDF, review images, snapshot and delivery manifest"
        )
    }
    Write-JsonFileAtomic -PathValue (Join-Path $stageRoot "runtime-manifest.json") -Value $manifest
}

function Get-CodeSigningCertificate {
    if ([string]::IsNullOrWhiteSpace($SigningCertificateThumbprint)) {
        return $null
    }

    $thumbprint = $SigningCertificateThumbprint.Replace(" ", "").ToUpperInvariant()
    $certificate = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $thumbprint -and $_.HasPrivateKey }) | Select-Object -First 1
    if (-not $certificate) {
        throw "Code-signing certificate with private key was not found: $thumbprint"
    }
    if ($certificate.NotAfter -le [DateTime]::UtcNow) {
        throw "Code-signing certificate is expired: $thumbprint"
    }
    return $certificate
}

function Sign-And-Verify {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        $Certificate
    )

    if ($Certificate) {
        $signature = Set-AuthenticodeSignature -LiteralPath $PathValue -Certificate $Certificate -HashAlgorithm SHA256 -TimestampServer $TimestampServer
        if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
            throw "Authenticode signing failed for ${PathValue}: $($signature.Status) $($signature.StatusMessage)"
        }
    }

    $verified = Get-AuthenticodeSignature -LiteralPath $PathValue
    if (-not $AllowUnsignedCandidate -and $verified.Status -ne [Management.Automation.SignatureStatus]::Valid) {
        throw "A valid Authenticode signature is required for ordinary-user delivery: $PathValue ($($verified.Status))."
    }
    return $verified
}

if (-not (Test-Path -LiteralPath $dependencyPath -PathType Leaf)) {
    throw "Runtime dependency manifest was not found: $dependencyPath"
}
$dependencies = Get-Content -LiteralPath $dependencyPath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$dependencies.schemaVersion -ne "1.0") {
    throw "Unsupported runtime dependency manifest."
}

$projectPath = Join-Path $repoRoot "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj"
[xml]$project = Get-Content -LiteralPath $projectPath -Raw -Encoding utf8
$projectVersion = [string]$project.SelectSingleNode("/Project/PropertyGroup/Version").InnerText
if ($projectVersion -ne $Version) {
    throw "Release version $Version does not match the source project version $projectVersion."
}
if ([string]::IsNullOrWhiteSpace($currentCommit)) {
    throw "Unable to resolve the current source commit."
}
$certificate = Get-CodeSigningCertificate
if (-not $certificate -and -not $AllowUnsignedCandidate) {
    throw "No code-signing certificate was supplied. Use a protected signing identity; -AllowUnsignedCandidate is only for local engineering verification."
}
if (-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim())) {
    throw "Ordinary-user packaging requires a clean working tree."
}

$resolvedIsccPath = Resolve-IsccPath -RequestedPath $IsccPath

[IO.Directory]::CreateDirectory($stageRoot) | Out-Null
[IO.Directory]::CreateDirectory($stableRoot) | Out-Null
[IO.Directory]::CreateDirectory($portableRoot) | Out-Null
[IO.Directory]::CreateDirectory($sourceRoot) | Out-Null

try {
    if (-not $SkipPublish) {
        & (Join-Path $repoRoot "scripts/publish-app.ps1") -RuntimeIdentifier "win-x64" -Version $Version -SelfContained
        if ($LASTEXITCODE -ne 0) {
            throw "Release application publish failed."
        }
    }
    if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
        throw "Published application directory was not found: $publishRoot"
    }
    if (-not (Test-Path -LiteralPath $smokeReportPath -PathType Leaf)) {
        throw "Published application smoke report was not found: $smokeReportPath"
    }
    $smokeReport = Get-Content -LiteralPath $smokeReportPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$smokeReport.status -ne "passed" -or [string]$smokeReport.source.commit -ne $currentCommit -or [bool]$smokeReport.source.dirty) {
        throw "Published application smoke report does not bind the current clean commit."
    }

    Copy-Item -Path (Join-Path $publishRoot "*") -Destination $stageRoot -Recurse -Force
    Copy-PublishNotices -DestinationDirectory $stageRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot "prompts") -Destination (Join-Path $stageRoot "prompts") -Recurse -Force
    if (Test-Path -LiteralPath (Join-Path $repoRoot ".snapshot-cache") -PathType Container) {
        Copy-Item -LiteralPath (Join-Path $repoRoot ".snapshot-cache") -Destination (Join-Path $stageRoot ".snapshot-cache") -Recurse -Force
    }
    foreach ($evalResult in Get-ChildItem -LiteralPath (Join-Path $repoRoot "eval") -File -Filter "latest.json" -Recurse) {
        $relativeEvalPath = [IO.Path]::GetRelativePath($repoRoot, $evalResult.FullName)
        $targetEvalPath = Join-Path $stageRoot $relativeEvalPath
        [IO.Directory]::CreateDirectory((Split-Path -Parent $targetEvalPath)) | Out-Null
        Copy-Item -LiteralPath $evalResult.FullName -Destination $targetEvalPath -Force
    }
    [IO.Directory]::CreateDirectory((Join-Path $stageRoot "tools")) | Out-Null
    foreach ($toolName in @("ai-gateway", "latex-renderer", "rule-compiler", "spec-assembler")) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "tools/$toolName") -Destination (Join-Path $stageRoot "tools/$toolName") -Recurse -Force
    }
    foreach ($sharedFile in @("atomic-write.mjs", "safe-remove.mjs", "shared.mjs")) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "tools/$sharedFile") -Destination (Join-Path $stageRoot "tools/$sharedFile") -Force
    }
    Get-ChildItem -LiteralPath (Join-Path $stageRoot "tools") -Directory -Filter "node_modules" -Recurse -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $stageRoot "tools") -File -Filter "*.test.mjs" -Recurse |
        Remove-Item -Force

    foreach ($toolName in @("ai-gateway", "latex-renderer")) {
        Invoke-CheckedNative -FileName "npm" -Arguments @("--prefix", (Join-Path $stageRoot "tools/$toolName"), "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund") -WorkingDirectory $stageRoot -FailureMessage "Unable to restore packaged $toolName dependencies."
    }

    $nodeArchivePath = Join-Path $workRoot "node-runtime.zip"
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$dependencies.node.archiveUrl) -OutFile $nodeArchivePath
    $nodeHash = Get-FileSha256 -PathValue $nodeArchivePath
    if ($nodeHash -ne ([string]$dependencies.node.sha256).ToLowerInvariant()) {
        throw "Node runtime archive SHA-256 mismatch. Expected $($dependencies.node.sha256), got $nodeHash."
    }
    Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $nodeExtractRoot -Force
    $nodeDistributionRoot = Get-ChildItem -LiteralPath $nodeExtractRoot -Directory | Select-Object -First 1
    if (-not $nodeDistributionRoot) {
        throw "Node runtime archive did not contain a distribution directory."
    }
    $bundledNodeRoot = Join-Path $stageRoot "runtime/node"
    [IO.Directory]::CreateDirectory($bundledNodeRoot) | Out-Null
    foreach ($nodeFile in @("node.exe", "LICENSE")) {
        $sourcePath = Join-Path $nodeDistributionRoot.FullName $nodeFile
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Node runtime file was not found in the verified archive: $nodeFile"
        }
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $bundledNodeRoot $nodeFile) -Force
    }

    [IO.Directory]::CreateDirectory((Join-Path $stageRoot ".snapshot-cache")) | Out-Null
    foreach ($subjectPack in @("junior-physics-answer", "senior-physics-answer", "math-answer")) {
        & (Join-Path $bundledNodeRoot "node.exe") (Join-Path $stageRoot "tools/rule-compiler/compile-snapshot.mjs") --subject-pack $subjectPack --profile classroom
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to compile packaged snapshot for $subjectPack."
        }
    }

    $appSignature = Sign-And-Verify -PathValue (Join-Path $stageRoot "ClassroomToolkit.App.exe") -Certificate $certificate

    Write-RuntimeManifest -DistributionMode "installer" -Certificate $certificate
    $bundleSmoke = & (Join-Path $stageRoot "ClassroomToolkit.App.exe") --smoke --repository-root $stageRoot 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $bundleSmoke -notmatch "workspaceHealthy=True") {
        throw "Packaged runtime smoke failed: $bundleSmoke"
    }

    $setupBaseName = "ClassroomToolkit-$Version-setup"
    Invoke-CheckedNative -FileName $resolvedIsccPath -Arguments @(
        "/DStageRoot=$stageRoot",
        "/DOutputDir=$stableRoot",
        "/DAppVersion=$Version",
        "/DOutputBaseFilename=$setupBaseName",
        $innoSourcePath) -WorkingDirectory $repoRoot -FailureMessage "Inno Setup compilation failed."
    $setupPath = Join-Path $stableRoot "$setupBaseName.exe"
    if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
        throw "Installer output was not created: $setupPath"
    }
    $setupSignature = Sign-And-Verify -PathValue $setupPath -Certificate $certificate

    Write-RuntimeManifest -DistributionMode "portable" -Certificate $certificate
    $portablePath = Join-Path $portableRoot "ClassroomToolkit-$Version-portable-win-x64.zip"
    if (Test-Path -LiteralPath $portablePath) {
        Remove-Item -LiteralPath $portablePath -Force
    }
    Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $portablePath -CompressionLevel Optimal

    $sourcePath = Join-Path $sourceRoot "ClassroomToolkit-$Version-source.zip"
    Invoke-CheckedNative -FileName "git" -Arguments @("-C", $repoRoot, "archive", "--format=zip", "--output=$sourcePath", "HEAD") -WorkingDirectory $repoRoot -FailureMessage "Unable to create the source archive."

    $installManifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-install-manifest"
        version = $Version
        sourceCommit = $currentCommit
        workspaceContract = $WorkspaceContract
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        publisherSignature = [ordered]@{
            status = [string]$setupSignature.Status
            signerSubject = if ($setupSignature.SignerCertificate) { $setupSignature.SignerCertificate.Subject } else { $null }
            signerThumbprint = if ($setupSignature.SignerCertificate) { $setupSignature.SignerCertificate.Thumbprint } else { $null }
        }
        assets = @(
            [ordered]@{ kind = "installer"; name = [IO.Path]::GetFileName($setupPath); sha256 = Get-FileSha256 -PathValue $setupPath; bytes = (Get-Item -LiteralPath $setupPath).Length },
            [ordered]@{ kind = "portable"; name = [IO.Path]::GetFileName($portablePath); sha256 = Get-FileSha256 -PathValue $portablePath; bytes = (Get-Item -LiteralPath $portablePath).Length },
            [ordered]@{ kind = "source"; name = [IO.Path]::GetFileName($sourcePath); sha256 = Get-FileSha256 -PathValue $sourcePath; bytes = (Get-Item -LiteralPath $sourcePath).Length }
        )
        runtime = [ordered]@{
            nodeVersion = [string]$dependencies.node.version
            nodeArchiveSha256 = [string]$dependencies.node.sha256
            appSignatureStatus = [string]$appSignature.Status
        }
    }
    Write-JsonFileAtomic -PathValue (Join-Path $stableRoot "install-manifest.json") -Value $installManifest

    $releaseBaseUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version"
    $updateManifest = [ordered]@{
        schemaVersion = "2.0"
        kind = "classroom-toolkit-update-manifest"
        channel = "stable"
        audience = "ordinary-users"
        version = $Version
        workspaceContract = $WorkspaceContract
        sourceCommit = $currentCommit
        releaseUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v$Version"
        releaseNotes = "Classroom Answer Toolkit $Version"
        assets = @($installManifest.assets | ForEach-Object {
            [ordered]@{
                kind = $_.kind
                name = $_.name
                url = "$releaseBaseUrl/$($_.name)"
                sha256 = $_.sha256
                bytes = $_.bytes
            }
        })
    }
    Write-JsonFileAtomic -PathValue (Join-Path $stableRoot "update-manifest.json") -Value $updateManifest

    Write-Host "Ordinary-user installer: $setupPath"
    Write-Host "Portable package: $portablePath"
    Write-Host "Source package: $sourcePath"
    Write-Host "Installer signature: $($setupSignature.Status)"
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
