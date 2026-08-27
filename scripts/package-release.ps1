#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$WorkspaceContract = "1",
    [ValidateSet("developer-operator-preview", "ordinary-users")][string]$Audience = "developer-operator-preview",
    [string]$OutputDirectory = "artifacts\deliveries",
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "transfer-common.ps1")

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot
$outputParent = Resolve-TransferPath -PathValue $OutputDirectory -BasePath $repoRoot
$outputRoot = Join-Path $outputParent $Version
$stageParent = Join-Path ([IO.Path]::GetTempPath()) ("ClassroomToolkit-release-{0}" -f [Guid]::NewGuid().ToString("N"))
$appStageRoot = Join-Path $stageParent "app"
$publishRoot = Join-Path $repoRoot "artifacts/work/publish/ClassroomToolkit.App"
$smokeReportPath = Join-Path $repoRoot "artifacts/work/publish/verification/ClassroomToolkit.App.smoke-report.json"
$appZipName = "ClassroomToolkit-$Version-win-x64.zip"
$sourceZipName = "ClassroomToolkit-$Version-source.zip"
$currentCommit = ((& git -C $repoRoot rev-parse HEAD 2>$null | Out-String).Trim())

function Assert-PublishReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$PublishDirectory,
        [Parameter(Mandatory = $true)][string]$ReportPath,
        [Parameter(Mandatory = $true)][string]$ExpectedCommit
    )

    if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) {
        throw "Published application smoke report was not found: $ReportPath"
    }
    $report = Get-Content -LiteralPath $ReportPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$report.schemaVersion -ne "1.1" -or [string]$report.kind -ne "published-app-smoke-report" -or [string]$report.status -ne "passed") {
        throw "Published application smoke report is unsupported or not passed."
    }
    if ([bool]$report.source.dirty -or [string]$report.source.commit -ne $ExpectedCommit) {
        throw "Published application smoke report does not bind the current clean source commit."
    }
    $reportedDirectory = [IO.Path]::GetFullPath([string]$report.publishDirectoryPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $expectedDirectory = [IO.Path]::GetFullPath($PublishDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not [string]::Equals($reportedDirectory, $expectedDirectory, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Published application smoke report binds another publish directory."
    }

    $exePath = Join-Path $PublishDirectory "ClassroomToolkit.App.exe"
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        throw "Published application executable was not found: $exePath"
    }
    $exeItem = Get-Item -LiteralPath $exePath
    $exeHash = Get-FileSha256 -PathValue $exePath
    if ([long]$report.executable.bytes -ne $exeItem.Length -or [string]$report.executable.sha256 -ne $exeHash) {
        throw "Published application smoke report executable integrity mismatch."
    }

    $actualTree = Get-DirectoryTreeReceipt -DirectoryPath $PublishDirectory
    if ([string]$report.publishTree.sha256 -ne $actualTree.sha256 -or
        [long]$report.publishTree.fileCount -ne $actualTree.fileCount -or
        [long]$report.publishTree.bytes -ne $actualTree.bytes) {
        throw "Published application smoke report tree integrity mismatch."
    }
}

function Copy-PublishNotices {
    param([Parameter(Mandatory = $true)][string]$DestinationDirectory)

    Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $DestinationDirectory "LICENSE.txt") -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $DestinationDirectory "THIRD_PARTY_NOTICES.md") -Force

    $depsPath = Join-Path $repoRoot "src/ClassroomToolkit.App/obj/Release/net10.0-windows/win-x64/ClassroomToolkit.App.deps.json"
    if (-not (Test-Path -LiteralPath $depsPath -PathType Leaf)) {
        throw "Published application dependency manifest was not found: $depsPath"
    }
    $deps = Get-Content -LiteralPath $depsPath -Raw -Encoding utf8 | ConvertFrom-Json
    $libraryNames = @($deps.libraries.PSObject.Properties.Name)
    $runtimeLibrary = @($libraryNames | Where-Object { $_ -like "runtimepack.Microsoft.NETCore.App.Runtime.win-x64/*" }) | Select-Object -First 1
    $desktopLibrary = @($libraryNames | Where-Object { $_ -like "runtimepack.Microsoft.WindowsDesktop.App.Runtime.win-x64/*" }) | Select-Object -First 1
    $toolkitLibrary = @($libraryNames | Where-Object { $_ -like "CommunityToolkit.Mvvm/*" }) | Select-Object -First 1
    if (-not $runtimeLibrary -or -not $desktopLibrary -or -not $toolkitLibrary) {
        throw "Unable to resolve runtime notice package versions from the publish dependency manifest."
    }

    $nugetRoot = if ([string]::IsNullOrWhiteSpace($env:NUGET_PACKAGES)) {
        Join-Path $env:USERPROFILE ".nuget/packages"
    }
    else {
        [IO.Path]::GetFullPath($env:NUGET_PACKAGES)
    }
    $runtimeVersion = ($runtimeLibrary -split "/")[-1]
    $desktopVersion = ($desktopLibrary -split "/")[-1]
    $toolkitVersion = ($toolkitLibrary -split "/")[-1]
    $noticeFiles = [ordered]@{
        (Join-Path $nugetRoot "microsoft.netcore.app.runtime.win-x64/$runtimeVersion/LICENSE.TXT") = "DOTNET-LICENSE.txt"
        (Join-Path $nugetRoot "microsoft.netcore.app.runtime.win-x64/$runtimeVersion/THIRD-PARTY-NOTICES.TXT") = "DOTNET-THIRD-PARTY-NOTICES.txt"
        (Join-Path $nugetRoot "microsoft.windowsdesktop.app.runtime.win-x64/$desktopVersion/LICENSE") = "WINDOWS-DESKTOP-RUNTIME-LICENSE.txt"
        (Join-Path $nugetRoot "communitytoolkit.mvvm/$toolkitVersion/License.md") = "COMMUNITYTOOLKIT-MVVM-LICENSE.md"
        (Join-Path $nugetRoot "communitytoolkit.mvvm/$toolkitVersion/ThirdPartyNotices.txt") = "COMMUNITYTOOLKIT-MVVM-NOTICES.txt"
    }
    foreach ($entry in $noticeFiles.GetEnumerator()) {
        if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) {
            throw "Required runtime notice file was not found: $($entry.Key)"
        }
        Copy-Item -LiteralPath $entry.Key -Destination (Join-Path $DestinationDirectory $entry.Value) -Force
    }
}

$projectPath = Join-Path $repoRoot "src/ClassroomToolkit.App/ClassroomToolkit.App.csproj"
[xml]$project = Get-Content -LiteralPath $projectPath -Raw -Encoding utf8
$projectVersionNode = $project.SelectSingleNode("/Project/PropertyGroup/Version")
$projectVersion = if ($null -eq $projectVersionNode) { "<missing>" } else { [string]$projectVersionNode.InnerText }
if ($projectVersion -ne $Version) {
    throw "Release version $Version does not match the source project version $projectVersion."
}

if (-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim())) {
    throw "Release packaging requires a clean working tree. Commit or stash source changes first."
}

[IO.Directory]::CreateDirectory($stageParent) | Out-Null
[IO.Directory]::CreateDirectory($appStageRoot) | Out-Null
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null

try {
    if (-not $SkipPublish) {
        & (Join-Path $repoRoot "scripts/publish-app.ps1") `
            -RuntimeIdentifier "win-x64" `
            -Version $Version `
            -SelfContained
        if ($LASTEXITCODE -ne 0) {
            throw "Release application publish failed."
        }
    }

    if (-not (Test-Path -LiteralPath $publishRoot -PathType Container)) {
        throw "Published application directory was not found: $publishRoot"
    }
    Assert-PublishReceipt -PublishDirectory $publishRoot -ReportPath $smokeReportPath -ExpectedCommit $currentCommit

    $publishedExe = Join-Path $publishRoot "ClassroomToolkit.App.exe"
    $publishedVersion = ([Diagnostics.FileVersionInfo]::GetVersionInfo($publishedExe).ProductVersion -split '\+')[0]
    if ($publishedVersion -ne $Version) {
        throw "Published application version $publishedVersion does not match release version $Version."
    }
    $signature = Get-AuthenticodeSignature -FilePath $publishedExe
    if ($Audience -eq "ordinary-users" -and [string]$signature.Status -ne "Valid") {
        throw "Ordinary-user release requires a valid Authenticode signature; current status is $($signature.Status)."
    }

    $sourceArchive = Join-Path $outputRoot $sourceZipName
    Invoke-CheckedNative -FileName "git" -Arguments @("-C", $repoRoot, "archive", "--format=zip", "--output=$sourceArchive", "HEAD") -WorkingDirectory $repoRoot -FailureMessage "Unable to create the source archive."

    Copy-Item -Path (Join-Path $publishRoot "*") -Destination $appStageRoot -Recurse -Force
    Copy-PublishNotices -DestinationDirectory $appStageRoot

    $appUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$appZipName"
    $manifest = [ordered]@{
        schemaVersion = "1.0"
        kind = "classroom-toolkit-update-manifest"
        channel = if ($Audience -eq "ordinary-users") { "stable" } else { "preview" }
        audience = $Audience
        version = $Version
        releaseUrl = "https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v$Version"
        releaseNotes = "Classroom Answer Toolkit $Version"
        sourceCommit = $currentCommit
        workspaceContract = $WorkspaceContract
        publisherSignature = [ordered]@{
            status = [string]$signature.Status
            signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        }
        generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
        assets = @(
            [ordered]@{
                kind = "app"
                name = $appZipName
                url = $appUrl
                sha256 = "pending"
                bytes = 0
            },
            [ordered]@{
                kind = "source"
                name = $sourceZipName
                url = "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v$Version/$sourceZipName"
                sha256 = Get-FileSha256 -PathValue $sourceArchive
                bytes = (Get-Item -LiteralPath $sourceArchive).Length
            }
        )
    }
    $appZipPath = Join-Path $outputRoot $appZipName
    if (Test-Path -LiteralPath $appZipPath) {
        Remove-Item -LiteralPath $appZipPath -Force
    }
    Compress-Archive -Path (Join-Path $appStageRoot "*") -DestinationPath $appZipPath -CompressionLevel Optimal

    $appItem = Get-Item -LiteralPath $appZipPath
    $manifest.assets[0].sha256 = Get-FileSha256 -PathValue $appZipPath
    $manifest.assets[0].bytes = $appItem.Length
    # Keep the manifest outside the package: embedding it would make its own
    # asset hash self-referential and impossible to verify deterministically.
    $manifestPath = Join-Path $outputRoot "update-manifest.json"
    Write-JsonFileAtomic -PathValue $manifestPath -Value $manifest

    Write-Host "Release package: $appZipPath"
    Write-Host "Source package: $(Join-Path $outputRoot $sourceZipName)"
    Write-Host "Update manifest: $manifestPath"
    Write-Host "Application package SHA-256: $(Get-FileSha256 -PathValue $appZipPath)"
}
finally {
    if (Test-Path -LiteralPath $stageParent) {
        Remove-Item -LiteralPath $stageParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}
