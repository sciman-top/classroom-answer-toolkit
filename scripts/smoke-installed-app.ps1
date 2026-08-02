param(
    [string]$PublishDir = "artifacts\publish\ClassroomToolkit.App",
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if ([System.IO.Path]::IsPathRooted($PublishDir)) {
    $publishDir = $PublishDir
} else {
    $publishDir = Join-Path $repoRoot $PublishDir
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $reportDir = Join-Path (Split-Path -Path $publishDir -Parent) "verification"
    $reportPath = Join-Path $reportDir ("{0}.smoke-report.json" -f (Split-Path -Path $publishDir -Leaf))
} elseif ([System.IO.Path]::IsPathRooted($ReportPath)) {
    $reportPath = $ReportPath
} else {
    $reportPath = Join-Path $repoRoot $ReportPath
}

$exePath = Join-Path $publishDir "ClassroomToolkit.App.exe"
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Published app not found: $exePath"
}

Write-Host "Running published app smoke: $exePath --smoke"
$stdoutPath = Join-Path $env:TEMP ("ClassroomToolkit-smoke-{0}.stdout.log" -f ([guid]::NewGuid().ToString("N")))
$stderrPath = Join-Path $env:TEMP ("ClassroomToolkit-smoke-{0}.stderr.log" -f ([guid]::NewGuid().ToString("N")))

try {
    $process = Start-Process -FilePath $exePath -ArgumentList @("--smoke", "--repository-root", $repoRoot) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    if ($process.ExitCode -ne 0) {
        throw "Published app smoke failed with exit code $($process.ExitCode)."
    }

    $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
    $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
    $smokeText = ($stdoutText + [Environment]::NewLine + $stderrText).Trim()
    $smokeData = @{}
    foreach ($line in ($smokeText -split "\r?\n")) {
        if ($line -match '^(?<key>[^=]+)=(?<value>.*)$') {
            $smokeData[$matches['key']] = $matches['value']
        }
    }

    $requiredKeys = @(
        "repositoryRoot",
        "workspaceSummary",
        "workspaceHealthy",
        "healthSummary",
        "primarySubjectPack",
        "subjectPacks",
        "snapshotPath",
        "evalOk",
        "evalCaseCount")
    foreach ($key in $requiredKeys) {
        if (-not $smokeData.ContainsKey($key)) {
            throw "Published app smoke did not report $key."
        }
    }

    if (-not [bool]::Parse([string]$smokeData["workspaceHealthy"])) {
        throw "Published app reported an unhealthy workspace: $($smokeData['healthSummary'])"
    }
    if (-not [bool]::Parse([string]$smokeData["evalOk"])) {
        throw "Published app reported failed evaluation state."
    }
    if ([string]::IsNullOrWhiteSpace([string]$smokeData["primarySubjectPack"])) {
        throw "Published app did not identify a primary subject pack."
    }

    $subjectPacks = @(
        [string]$smokeData["subjectPacks"] -split "," |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($subjectPacks.Count -lt 1) {
        throw "Published app did not report any subject packs."
    }

    $report = [ordered]@{
        schemaVersion = "1.0"
        kind = "published-app-smoke-report"
        status = "passed"
        generatedAt = [DateTimeOffset]::Now.ToString("O")
        publishDirectoryPath = $publishDir
        executablePath = $exePath
        smoke = [ordered]@{
            repositoryRoot = [string]$smokeData["repositoryRoot"]
            workspaceSummary = [string]$smokeData["workspaceSummary"]
            workspaceHealthy = [bool]::Parse([string]$smokeData["workspaceHealthy"])
            healthSummary = [string]$smokeData["healthSummary"]
            primarySubjectPack = [string]$smokeData["primarySubjectPack"]
            subjectPacks = $subjectPacks
            snapshotPath = [string]$smokeData["snapshotPath"]
            evalOk = [bool]::Parse([string]$smokeData["evalOk"])
            evalCaseCount = [int]$smokeData["evalCaseCount"]
        }
    }

    New-Item -ItemType Directory -Path (Split-Path -Path $reportPath -Parent) -Force | Out-Null
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8

    Write-Host "Smoke report: $reportPath"
    Write-Host $smokeText
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}
