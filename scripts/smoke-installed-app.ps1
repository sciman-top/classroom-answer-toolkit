#requires -Version 7
param(
    [string]$PublishDir = "artifacts\work\publish\ClassroomToolkit.App",
    [string]$ReportPath = ""
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
            lastWriteAt = $_.LastWriteTimeUtc.ToString("O")
        }
    } | Sort-Object { $_["relativePath"] })
    $canonical = ($entries | ForEach-Object { "{0}|{1}|{2}" -f $_["relativePath"], $_["bytes"], $_["sha256"] }) -join "`n"
    $treeHashBytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))
    $treeHash = [Convert]::ToHexString($treeHashBytes).ToLowerInvariant()
    $totalBytes = ($entries | ForEach-Object { [long]$_["bytes"] } | Measure-Object -Sum).Sum
    if ($null -eq $totalBytes) {
        $totalBytes = 0
    }
    $latestWriteAt = if ($entries.Count -gt 0) {
        ($entries | Sort-Object { $_["lastWriteAt"] } -Descending | Select-Object -First 1)["lastWriteAt"]
    }
    else {
        $null
    }

    return [ordered]@{
        algorithm = "sha256"
        sha256 = $treeHash
        fileCount = $entries.Count
        bytes = [long]$totalBytes
        latestWriteAt = $latestWriteAt
    }
}

function Write-JsonFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = [IO.Path]::GetDirectoryName($PathValue)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = Join-Path $directory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($PathValue), [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporaryPath, $PathValue, $true)
    }
    finally {
        [IO.File]::Delete($temporaryPath)
    }
}

$publishDir = Resolve-RepoPath $PublishDir
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $reportDir = Join-Path (Split-Path -Path $publishDir -Parent) "verification"
    $reportPath = Join-Path $reportDir ("{0}.smoke-report.json" -f (Split-Path -Path $publishDir -Leaf))
}
else {
    $reportPath = Resolve-RepoPath $ReportPath
}

$exePath = Join-Path $publishDir "ClassroomToolkit.App.exe"
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Published app not found: $exePath"
}

$isolationRoot = Join-Path $env:TEMP ("ClassroomToolkit-published-smoke-{0}" -f [Guid]::NewGuid().ToString("N"))
$isolatedPublishDir = Join-Path $isolationRoot "ClassroomToolkit.App"
$isolatedExePath = Join-Path $isolatedPublishDir "ClassroomToolkit.App.exe"
$stdoutPath = Join-Path $env:TEMP ("ClassroomToolkit-smoke-{0}.stdout.log" -f [Guid]::NewGuid().ToString("N"))
$stderrPath = Join-Path $env:TEMP ("ClassroomToolkit-smoke-{0}.stderr.log" -f [Guid]::NewGuid().ToString("N"))

Write-Host "Running isolated published app smoke: $isolatedExePath --smoke"
try {
    [IO.Directory]::CreateDirectory($isolatedPublishDir) | Out-Null
    Copy-Item -Path (Join-Path $publishDir "*") -Destination $isolatedPublishDir -Recurse -Force

    # -Wait has no deadline; a hung app would stall smoke (and publish-app) forever.
    $process = Start-Process -FilePath $isolatedExePath -ArgumentList @("--smoke") -WorkingDirectory $isolatedPublishDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    if (-not $process.WaitForExit(120000)) {
        $process.Kill($true)
        throw "Published app smoke timed out after 120 seconds."
    }
    if ($process.ExitCode -ne 0) {
        throw "Published app smoke failed with exit code $($process.ExitCode)."
    }

    $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -Encoding utf8 } else { "" }
    $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -Encoding utf8 } else { "" }
    $smokeText = ($stdoutText + [Environment]::NewLine + $stderrText).Trim()
    $smokeData = @{}
    foreach ($line in ($smokeText -split "\r?\n")) {
        if ($line -match '^(?<key>[^=]+)=(?<value>.*)$') {
            $smokeData[$matches['key']] = $matches['value']
        }
    }

    foreach ($key in @("repositoryRoot", "workspaceHealthy", "healthSummary", "subjectPacks", "evalOk")) {
        if (-not $smokeData.ContainsKey($key)) {
            throw "Published app smoke did not report $key."
        }
    }

    $reportedRoot = [IO.Path]::GetFullPath([string]$smokeData["repositoryRoot"]).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $expectedRoot = [IO.Path]::GetFullPath($isolatedPublishDir).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not [string]::Equals($reportedRoot, $expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Published app escaped its isolated tree: reported repository root $reportedRoot"
    }
    if ([bool]::Parse([string]$smokeData["workspaceHealthy"])) {
        throw "Published app unexpectedly reported a healthy bundled workspace; the publish tree must not masquerade as a self-contained toolchain."
    }
    if ([bool]::Parse([string]$smokeData["evalOk"])) {
        throw "Published app unexpectedly reported evaluation success without an external repository."
    }
    $subjectPacks = @([string]$smokeData["subjectPacks"] -split "," | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($subjectPacks.Count -ne 0) {
        throw "Published app unexpectedly discovered subject packs outside the isolated publish tree."
    }

    $sourceCommit = (& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceCommit)) {
        throw "Unable to resolve the source commit for the smoke report."
    }
    $sourceDirty = -not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=no | Out-String).Trim())
    $exeItem = Get-Item -LiteralPath $exePath
    $publishTree = Get-PublishTreeReceipt -DirectoryPath $publishDir
    $report = [ordered]@{
        schemaVersion = "1.1"
        kind = "published-app-smoke-report"
        status = "passed"
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        source = [ordered]@{
            commit = $sourceCommit
            dirty = $sourceDirty
        }
        publishDirectoryPath = $publishDir
        executable = [ordered]@{
            path = $exeItem.FullName
            bytes = $exeItem.Length
            sha256 = (Get-FileHash -LiteralPath $exeItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        publishTree = $publishTree
        smoke = [ordered]@{
            isolationMode = "published-tree-only"
            repositoryCoupled = $true
            capability = "launch-and-fail-closed-only"
            repositoryRoot = [string]$smokeData["repositoryRoot"]
            workspaceHealthy = [bool]::Parse([string]$smokeData["workspaceHealthy"])
            healthSummary = [string]$smokeData["healthSummary"]
            subjectPacks = $subjectPacks
            evalOk = [bool]::Parse([string]$smokeData["evalOk"])
        }
    }

    Write-JsonFileAtomic -PathValue $reportPath -Value $report
    Write-Host "Smoke report: $reportPath"
    Write-Host $smokeText
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $isolationRoot -Recurse -Force -ErrorAction SilentlyContinue
}
