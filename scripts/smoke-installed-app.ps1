param(
    [string]$PublishDir = "artifacts\publish\ClassroomToolkit.App"
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

    $bundleMatch = [regex]::Match($smokeText, '^diagnosticsBundlePath=(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $manifestMatch = [regex]::Match($smokeText, '^diagnosticsManifestPath=(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)

    if (-not $bundleMatch.Success) {
        throw "Published app smoke did not report diagnosticsBundlePath."
    }

    if (-not $manifestMatch.Success) {
        throw "Published app smoke did not report diagnosticsManifestPath."
    }

    $bundlePath = $bundleMatch.Groups[1].Value.Trim()
    $manifestPath = $manifestMatch.Groups[1].Value.Trim()

    if (-not (Test-Path -LiteralPath $bundlePath)) {
        throw "Diagnostics bundle directory not found: $bundlePath"
    }

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Diagnostics manifest not found: $manifestPath"
    }

    Write-Host $smokeText
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}
