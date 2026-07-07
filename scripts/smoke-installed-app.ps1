param(
    [string]$PublishDir = "artifacts\publish\ClassroomToolkit.App",
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-BundleRelativePath {
    param(
        [string]$BaseFilePath,
        [string]$RelativePath
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        return $RelativePath
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $BaseFilePath -Parent) $RelativePath))
}

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

    foreach ($key in @(
        "repositoryRoot",
        "workspaceSummary",
        "workspaceHealthy",
        "healthSummary",
        "primarySubjectPack",
        "subjectPacks",
        "snapshotPath",
        "diagnosticsBundlePath",
        "diagnosticsManifestPath",
        "diagnosticsFileCount")) {
        $match = [regex]::Match(
            $smokeText,
            "^{0}=(.*)$" -f [regex]::Escape($key),
            [System.Text.RegularExpressions.RegexOptions]::Multiline)

        if (-not $match.Success) {
            throw "Published app smoke did not report $key."
        }
    }

    $bundleMatch = [regex]::Match($smokeText, '^diagnosticsBundlePath=(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $manifestMatch = [regex]::Match($smokeText, '^diagnosticsManifestPath=(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)

    $bundlePath = $bundleMatch.Groups[1].Value.Trim()
    $manifestPath = $manifestMatch.Groups[1].Value.Trim()
    $subjectPackIndexPath = Join-Path $bundlePath "workspace\subject-packs\index.json"

    if (-not (Test-Path -LiteralPath $bundlePath)) {
        throw "Diagnostics bundle directory not found: $bundlePath"
    }

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Diagnostics manifest not found: $manifestPath"
    }

    if (-not (Test-Path -LiteralPath $subjectPackIndexPath)) {
        throw "Diagnostics bundle missing subject-pack index: $subjectPackIndexPath"
    }

    $diagnosticManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($diagnosticManifest.kind) -or $diagnosticManifest.kind -ne "workspace-diagnostics-bundle") {
        throw "Diagnostics manifest kind mismatch."
    }

    if ([string]::IsNullOrWhiteSpace($diagnosticManifest.primarySubjectPack)) {
        throw "Diagnostics manifest missing primarySubjectPack."
    }

    $primarySubjectPackManifestPath = Join-Path $bundlePath ("workspace\prompts\{0}\manifest.json" -f [string]$diagnosticManifest.primarySubjectPack)
    if (-not (Test-Path -LiteralPath $primarySubjectPackManifestPath)) {
        throw "Diagnostics bundle missing primary subject-pack manifest: $primarySubjectPackManifestPath"
    }

    $primarySubjectPackManifest = Get-Content -LiteralPath $primarySubjectPackManifestPath -Raw | ConvertFrom-Json
    if ($null -eq $primarySubjectPackManifest.sourceOfTruth) {
        throw "Diagnostics primary subject-pack manifest missing sourceOfTruth."
    }

    $bundledHumanSpecPath = Resolve-BundleRelativePath -BaseFilePath $primarySubjectPackManifestPath -RelativePath ([string]$primarySubjectPackManifest.sourceOfTruth.humanSpec)
    if ([string]::IsNullOrWhiteSpace($bundledHumanSpecPath) -or -not (Test-Path -LiteralPath $bundledHumanSpecPath)) {
        throw "Diagnostics bundle missing primary subject-pack humanSpec: $bundledHumanSpecPath"
    }

    $bundledMirroredSpecPath = Resolve-BundleRelativePath -BaseFilePath $primarySubjectPackManifestPath -RelativePath ([string]$primarySubjectPackManifest.sourceOfTruth.mirroredSpec)
    if ([string]::IsNullOrWhiteSpace($bundledMirroredSpecPath) -or -not (Test-Path -LiteralPath $bundledMirroredSpecPath)) {
        throw "Diagnostics bundle missing primary subject-pack mirroredSpec: $bundledMirroredSpecPath"
    }

    $bundledAcceptanceChecklistPath = Resolve-BundleRelativePath -BaseFilePath $primarySubjectPackManifestPath -RelativePath ([string]$primarySubjectPackManifest.sourceOfTruth.acceptanceChecklist)
    if ([string]::IsNullOrWhiteSpace($bundledAcceptanceChecklistPath) -or -not (Test-Path -LiteralPath $bundledAcceptanceChecklistPath)) {
        throw "Diagnostics bundle missing primary subject-pack acceptanceChecklist: $bundledAcceptanceChecklistPath"
    }

    if ($null -eq $diagnosticManifest.subjectPacks -or $diagnosticManifest.subjectPacks.Count -lt 1) {
        throw "Diagnostics manifest missing subjectPacks."
    }

    if ([string]::IsNullOrWhiteSpace($diagnosticManifest.snapshotPath)) {
        throw "Diagnostics manifest missing snapshotPath."
    }

    $diagnosticSubjectPacks = @($diagnosticManifest.subjectPacks | ForEach-Object { [string]$_ })
    $smokeSubjectPacks = @(
        [string]($smokeData["subjectPacks"]) -split "," |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    if ([string]$smokeData["primarySubjectPack"] -ne [string]$diagnosticManifest.primarySubjectPack) {
        throw "Smoke stdout primarySubjectPack does not match diagnostics manifest."
    }

    if ([string]$smokeData["snapshotPath"] -ne [string]$diagnosticManifest.snapshotPath) {
        throw "Smoke stdout snapshotPath does not match diagnostics manifest."
    }

    if (($smokeSubjectPacks -join ",") -ne ($diagnosticSubjectPacks -join ",")) {
        throw "Smoke stdout subjectPacks does not match diagnostics manifest."
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
            workspaceHealthy = [string]$smokeData["workspaceHealthy"]
            healthSummary = [string]$smokeData["healthSummary"]
            primarySubjectPack = [string]$smokeData["primarySubjectPack"]
            subjectPacks = $smokeSubjectPacks
            snapshotPath = [string]$smokeData["snapshotPath"]
            lastDeliverySubjectPack = [string]$smokeData["lastDeliverySubjectPack"]
            lastDeliveryProfile = [string]$smokeData["lastDeliveryProfile"]
            lastSnapshotId = [string]$smokeData["lastSnapshotId"]
            lastDeliverySnapshotPath = [string]$smokeData["lastDeliverySnapshotPath"]
            lastDeliverySnapshotVersion = [string]$smokeData["lastDeliverySnapshotVersion"]
            lastDeliveryInputPath = [string]$smokeData["lastDeliveryInputPath"]
            lastDeliveryOutputPath = [string]$smokeData["lastDeliveryOutputPath"]
            lastDeliveryReviewDirectoryPath = [string]$smokeData["lastDeliveryReviewDirectoryPath"]
            lastDeliveryReviewState = [string]$smokeData["lastDeliveryReviewState"]
            lastDeliveryFeedbackRefCount = [string]$smokeData["lastDeliveryFeedbackRefCount"]
            lastDeliveryVisualDecisionRef = [string]$smokeData["lastDeliveryVisualDecisionRef"]
            lastDeliveryVisualPolicyVersion = [string]$smokeData["lastDeliveryVisualPolicyVersion"]
            lastDeliveryOptimizationVersion = [string]$smokeData["lastDeliveryOptimizationVersion"]
            diagnosticsBundlePath = [string]$smokeData["diagnosticsBundlePath"]
            diagnosticsManifestPath = [string]$smokeData["diagnosticsManifestPath"]
            diagnosticsFileCount = [string]$smokeData["diagnosticsFileCount"]
        }
        diagnostics = [ordered]@{
            kind = [string]$diagnosticManifest.kind
            manifestPath = $manifestPath
            bundleDirectoryPath = $bundlePath
            subjectPackIndexPath = $subjectPackIndexPath
            primarySubjectPackManifestPath = $primarySubjectPackManifestPath
            primaryHumanSpecPath = $bundledHumanSpecPath
            primaryMirroredSpecPath = $bundledMirroredSpecPath
            primaryAcceptanceChecklistPath = $bundledAcceptanceChecklistPath
            primarySubjectPack = [string]$diagnosticManifest.primarySubjectPack
            subjectPacks = $diagnosticSubjectPacks
            snapshotPath = [string]$diagnosticManifest.snapshotPath
            lastSnapshotId = [string]$diagnosticManifest.lastSnapshotId
            health = $diagnosticManifest.health
            lastDeliveryContext = $diagnosticManifest.lastDeliveryContext
        }
    }

    New-Item -ItemType Directory -Path (Split-Path -Path $reportPath -Parent) -Force | Out-Null
    $report | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $reportPath -Encoding utf8

    Write-Host "Smoke report: $reportPath"
    Write-Host $smokeText
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}
