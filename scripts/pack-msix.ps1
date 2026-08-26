#requires -Version 7
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

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot

function Resolve-RepoPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if ([IO.Path]::IsPathFullyQualified($PathValue)) {
        return [IO.Path]::GetFullPath($PathValue)
    }

    return [IO.Path]::GetFullPath((Join-Path $repoRoot $PathValue))
}

function Get-PublishTreeReceipt {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)

    $entries = @(Get-ChildItem -LiteralPath $DirectoryPath -Recurse -File | ForEach-Object {
        [ordered]@{
            relativePath = [IO.Path]::GetRelativePath($DirectoryPath, $_.FullName).Replace("\", "/")
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Sort-Object { $_["relativePath"] })
    $canonical = ($entries | ForEach-Object { "{0}|{1}|{2}" -f $_["relativePath"], $_["bytes"], $_["sha256"] }) -join "`n"
    $treeHashBytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))
    $totalBytes = ($entries | ForEach-Object { [long]$_["bytes"] } | Measure-Object -Sum).Sum
    if ($null -eq $totalBytes) {
        $totalBytes = 0
    }

    return [ordered]@{
        sha256 = [Convert]::ToHexString($treeHashBytes).ToLowerInvariant()
        fileCount = $entries.Count
        bytes = [long]$totalBytes
    }
}

$publishDir = Resolve-RepoPath $PublishDir
$stageDir = Resolve-RepoPath $StageDir
$packageDir = Resolve-RepoPath $PackageDir
$smokeReportPath = if ([string]::IsNullOrWhiteSpace($SmokeReportPath)) {
    Join-Path (Join-Path $publishDir "..\verification") ("{0}.smoke-report.json" -f (Split-Path -Path $publishDir -Leaf))
}
else {
    Resolve-RepoPath $SmokeReportPath
}

$exePath = Join-Path $publishDir "ClassroomToolkit.App.exe"
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Published app not found. Run scripts/publish-app.ps1 first. Missing: $exePath"
}
if (-not (Test-Path -LiteralPath $smokeReportPath -PathType Leaf)) {
    throw "Published smoke report not found. Run scripts/publish-app.ps1 first. Missing: $smokeReportPath"
}

$smokeReport = Get-Content -LiteralPath $smokeReportPath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$smokeReport.schemaVersion -ne "1.1" -or
    [string]$smokeReport.kind -ne "published-app-smoke-report" -or
    [string]$smokeReport.status -ne "passed") {
    throw "Published smoke report is invalid or not a passed schemaVersion 1.1 receipt."
}

$reportedPublishDir = [IO.Path]::GetFullPath([string]$smokeReport.publishDirectoryPath)
if (-not [string]::Equals($reportedPublishDir, $publishDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Published smoke report belongs to a different publish directory: $reportedPublishDir"
}

$currentCommit = (& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentCommit)) {
    throw "Unable to resolve the current source commit."
}
if ([string]$smokeReport.source.commit -ne $currentCommit) {
    throw "Published smoke report is stale for the current commit. Expected $currentCommit, got $($smokeReport.source.commit)."
}
if ([bool]$smokeReport.source.dirty) {
    throw "Published smoke report was generated from a dirty source tree and cannot authorize packaging."
}
if ([string]$smokeReport.smoke.isolationMode -ne "published-tree-only" -or
    -not [bool]$smokeReport.smoke.repositoryCoupled) {
    throw "Published smoke report does not prove isolated repository-coupled launch behavior."
}

$reportedExePath = [IO.Path]::GetFullPath([string]$smokeReport.executable.path)
if (-not [string]::Equals($reportedExePath, $exePath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Published smoke report executable path does not match the current publish tree."
}
$exeItem = Get-Item -LiteralPath $exePath
$exeSha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([long]$smokeReport.executable.bytes -ne $exeItem.Length -or
    [string]$smokeReport.executable.sha256 -ne $exeSha256) {
    throw "Published smoke report executable SHA-256 or byte length does not match the current executable."
}

$currentTree = Get-PublishTreeReceipt -DirectoryPath $publishDir
if ([string]$smokeReport.publishTree.sha256 -ne $currentTree.sha256 -or
    [int]$smokeReport.publishTree.fileCount -ne $currentTree.fileCount -or
    [long]$smokeReport.publishTree.bytes -ne $currentTree.bytes) {
    throw "Published smoke report publish-tree SHA-256 does not match the current publish directory."
}

$generatedAt = [DateTimeOffset]::Parse([string]$smokeReport.generatedAt, [Globalization.CultureInfo]::InvariantCulture)
$latestWriteAt = [DateTimeOffset]::Parse([string]$smokeReport.publishTree.latestWriteAt, [Globalization.CultureInfo]::InvariantCulture)
if ($generatedAt -lt $latestWriteAt.AddSeconds(-1)) {
    throw "Published smoke report predates the current publish tree."
}
if ($generatedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
    throw "Published smoke report timestamp is unexpectedly in the future."
}
$currentSourceStatus = (& git -C $repoRoot status --porcelain --untracked-files=no | Out-String).Trim()
if (-not [string]::IsNullOrWhiteSpace($currentSourceStatus)) {
    throw "The current source tree is dirty and cannot authorize packaging."
}

throw (("MSIX packaging is blocked: the WPF executable is a repository-coupled companion and the publish tree intentionally excludes " +
    "the mutable repository toolchain, Node.js/npm, PowerShell, prompts, snapshots, and eval state. " +
    "Creating {0} in {1} would misrepresent it as a self-contained installable product. " +
    "Keep stage path {2} unused until a writable, versioned runtime bundle has its own install and upgrade contract.") -f $Version, $packageDir, $stageDir)
