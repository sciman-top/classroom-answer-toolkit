using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

[Trait("Gate", "ToolchainIntegration")]
public sealed class ToolchainCliBehaviorTests
{
    [Fact]
    public async Task SnapshotCliProducesManifestAlignedArtifact()
    {
        var root = FindRepoRoot();
        var outputDirectory = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-CliTests", Guid.NewGuid().ToString("N"));
        var outputPath = Path.Combine(outputDirectory, "snapshot.json");
        Directory.CreateDirectory(outputDirectory);

        try
        {
            var result = await RunAsync(
                "node",
                root,
                "tools/rule-compiler/compile-snapshot.mjs",
                "--subject-pack", "junior-physics-answer",
                "--profile", "classroom",
                "--out", outputPath);

            result.ExitCode.Should().Be(0, result.Output);
            File.Exists(outputPath).Should().BeTrue();
            using var document = JsonDocument.Parse(File.ReadAllText(outputPath));
            var snapshot = document.RootElement;
            snapshot.GetProperty("snapshotId").GetString().Should().StartWith("snapshot-");
            snapshot.GetProperty("subjectPack").GetProperty("assetId").GetString().Should().Be("junior-physics-answer");
            snapshot.GetProperty("subjectPack").GetProperty("version").GetString().Should().Be("v8.18");
            snapshot.GetProperty("activeProfile").GetProperty("name").GetString().Should().Be("classroom");
        }
        finally
        {
            if (Directory.Exists(outputDirectory)) Directory.Delete(outputDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task SnapshotCliRejectsUnknownSubjectPack()
    {
        var result = await RunAsync(
            "node",
            FindRepoRoot(),
            "tools/rule-compiler/compile-snapshot.mjs",
            "--subject-pack", "missing-subject-pack",
            "--profile", "classroom");

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("missing-subject-pack");
    }

    [Fact]
    public async Task PublishedSmokeFailsClosedWhenExecutableIsMissing()
    {
        var missingPublishDirectory = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-MissingPublish", Guid.NewGuid().ToString("N"));
        var result = await RunAsync(
            "pwsh",
            FindRepoRoot(),
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "scripts/smoke-installed-app.ps1",
            "-PublishDir", missingPublishDirectory);

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("Published app not found");
    }

    [Fact]
    public async Task MsixPackRejectsSmokeReceiptThatDoesNotBindCurrentExecutable()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-StalePublishReceipt", Guid.NewGuid().ToString("N"));
        var publishDirectory = Path.Combine(testRoot, "publish");
        var exePath = Path.Combine(publishDirectory, "ClassroomToolkit.App.exe");
        var reportPath = Path.Combine(testRoot, "smoke-report.json");
        Directory.CreateDirectory(publishDirectory);
        File.WriteAllText(exePath, "current-executable");
        var commit = (await RunAsync("git", root, "rev-parse", "HEAD")).Output.Trim();
        File.WriteAllText(reportPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.1",
            kind = "published-app-smoke-report",
            status = "passed",
            generatedAt = DateTimeOffset.UtcNow,
            source = new { commit, dirty = false },
            publishDirectoryPath = publishDirectory,
            executable = new { path = exePath, bytes = new FileInfo(exePath).Length, sha256 = new string('0', 64) },
            publishTree = new
            {
                sha256 = new string('0', 64),
                fileCount = 1,
                bytes = new FileInfo(exePath).Length,
                latestWriteAt = DateTimeOffset.UtcNow.AddSeconds(-1)
            },
            smoke = new { isolationMode = "published-tree-only", repositoryCoupled = true }
        }));

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/pack-msix.ps1",
                "-PublishDir", publishDirectory,
                "-SmokeReportPath", reportPath);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("executable SHA-256");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task InstallReleaseValidatesMissingEmptyAndNonEmptyDestinations()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-InstallDestination", Guid.NewGuid().ToString("N"));
        var destination = Path.Combine(testRoot, "install");

        try
        {
            var missingResult = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
                "-Destination", destination,
                "-ValidateDestinationOnly");
            missingResult.ExitCode.Should().Be(0, missingResult.Output);

            Directory.CreateDirectory(destination);
            var emptyResult = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
                "-Destination", destination,
                "-ValidateDestinationOnly");
            emptyResult.ExitCode.Should().Be(0, emptyResult.Output);

            File.WriteAllText(Path.Combine(destination, "occupied.txt"), "occupied");
            var occupiedResult = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
                "-Destination", destination,
                "-ValidateDestinationOnly");
            occupiedResult.ExitCode.Should().NotBe(0);
            occupiedResult.Output.Should().Contain("Destination is not empty");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task InstallReleaseAllowsLoopbackOnlyWithExplicitSimulationSwitch()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-LoopbackInstall", Guid.NewGuid().ToString("N"));
        var destination = Path.Combine(testRoot, "install");
        var manifestUrl = "http://127.0.0.1:43210/update-manifest.json";

        try
        {
            var rejected = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
                "-ManifestUrl", manifestUrl,
                "-Destination", destination,
                "-ValidateDestinationOnly");
            rejected.ExitCode.Should().NotBe(0);
            rejected.Output.Should().Contain("approved GitHub HTTPS host");

            var allowed = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
                "-ManifestUrl", manifestUrl,
                "-Destination", destination,
                "-ValidateDestinationOnly",
                "-AllowLocalSimulation");
            allowed.ExitCode.Should().Be(0, allowed.Output);
            allowed.Output.Should().Contain("Install destination is available");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task PackageReleaseRejectsVersionThatDoesNotMatchSourceProject()
    {
        var result = await RunAsync(
            "pwsh",
            FindRepoRoot(),
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/package-release.ps1",
            "-Version", "9.9.9",
            "-SkipPublish");

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("does not match the source project version");
    }

    [Fact]
    public async Task ArtifactCleanupKeepsCurrentDeliveryAndHistoryButRemovesWorkAndOldVersions()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ArtifactLayout", Guid.NewGuid().ToString("N"));
        var artifactsRoot = Path.Combine(testRoot, "artifacts");
        var currentDelivery = Path.Combine(artifactsRoot, "deliveries", "1.0.1");
        var oldDelivery = Path.Combine(artifactsRoot, "deliveries", "1.0.0");
        var history = Path.Combine(artifactsRoot, "history", "diagnostics", "20260827");
        var work = Path.Combine(artifactsRoot, "work", "publish");

        try
        {
            Directory.CreateDirectory(currentDelivery);
            Directory.CreateDirectory(oldDelivery);
            Directory.CreateDirectory(history);
            Directory.CreateDirectory(work);
            File.WriteAllText(Path.Combine(currentDelivery, "ClassroomToolkit-1.0.1-source.zip"), "current");
            File.WriteAllText(Path.Combine(oldDelivery, "ClassroomToolkit-1.0.0-source.zip"), "old");
            File.WriteAllText(Path.Combine(history, "receipt.json"), "history");
            File.WriteAllText(Path.Combine(work, "marker.txt"), "work");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/clean-artifacts.ps1",
                "-ArtifactsRoot", artifactsRoot,
                "-KeepVersion", "1.0.1");

            result.ExitCode.Should().Be(0, result.Output);
            Directory.Exists(currentDelivery).Should().BeTrue();
            Directory.Exists(oldDelivery).Should().BeFalse();
            Directory.Exists(work).Should().BeFalse();
            File.Exists(Path.Combine(history, "receipt.json")).Should().BeTrue();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task UpdateReleaseRejectsRestartExecutableOutsideTargetApp()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-UpdateContainment", Guid.NewGuid().ToString("N"));
        var targetApp = Path.Combine(testRoot, "app");
        Directory.CreateDirectory(targetApp);

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/update-release.ps1",
                "-PackageUrl", "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v0.0.0/missing.zip",
                "-ExpectedSha256", new string('a', 64),
                "-ExpectedBytes", "1",
                "-TargetAppDirectory", targetApp,
                "-RepositoryRoot", testRoot,
                "-ProcessId", "999999",
                "-RestartExecutable", Path.Combine(testRoot, "outside.exe"));

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("Path escapes root");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferPreservesExistingEnvWhenPackageDoesNotContainOne()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-PreserveEnv", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string> { ["workspace/readme.txt"] = "incoming" },
                "workspace/readme.txt");
            Directory.CreateDirectory(Path.Combine(destination, "workspace"));
            File.WriteAllText(Path.Combine(destination, "workspace", ".env"), "AUDIT_KEY=preserve-me");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination,
                "-AllowExistingDestination",
                "-PreserveExistingEnv");

            result.ExitCode.Should().Be(0, result.Output);
            File.ReadAllText(Path.Combine(destination, "workspace", ".env")).Should().Be("AUDIT_KEY=preserve-me");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferRestoresExistingDestinationWhenSetupFails()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Rollback", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string>
                {
                    ["workspace/scripts/setup-development.ps1"] = "exit 23",
                    ["workspace/new-marker.txt"] = "new"
                },
                "workspace/scripts/setup-development.ps1",
                "workspace/new-marker.txt");
            Directory.CreateDirectory(Path.Combine(destination, "workspace"));
            File.WriteAllText(Path.Combine(destination, "workspace", "old-marker.txt"), "old");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination,
                "-AllowExistingDestination",
                "-RunSetup");

            result.ExitCode.Should().NotBe(0);
            File.Exists(Path.Combine(destination, "workspace", "old-marker.txt")).Should().BeTrue();
            File.Exists(Path.Combine(destination, "workspace", "new-marker.txt")).Should().BeFalse();
            Directory.GetDirectories(testRoot, "destination.failed.*").Should().ContainSingle();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferRejectsFilesNotDeclaredByManifest()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ExtraFile", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string>
                {
                    ["workspace/readme.txt"] = "declared",
                    ["workspace/Directory.Build.targets"] = "unlisted"
                },
                "workspace/readme.txt");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("manifest file set mismatch");
            Directory.Exists(destination).Should().BeFalse();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowRejectsReferencePdfOutputCollisionBeforeRunningTools()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowCollision", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(outputDirectory, "exam参考答案.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-authority");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("collides with input ReferencePdf");
            File.ReadAllText(referencePath).Should().Be("%PDF-authority");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowRejectsWorkflowReceiptCollisionBeforeRunningTools()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowReceiptCollision", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "authoritative-input");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("collides with input ReferencePdf");
            result.Output.Should().Contain("WorkflowReceipt");
            File.ReadAllText(referencePath).Should().Be("authoritative-input");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowWritesFailureReceiptWithBoundInputs()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowFailure", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "broken.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "broken.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(testRoot);
        File.WriteAllText(sourcePath, "not-a-pdf");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-SkipVisualAudit");

            result.ExitCode.Should().NotBe(0);
            File.Exists(receiptPath).Should().BeTrue(result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(receiptPath));
            var receipt = document.RootElement;
            receipt.GetProperty("kind").GetString().Should().Be("live-answer-workflow-run");
            receipt.GetProperty("status").GetString().Should().Be("failed");
            receipt.GetProperty("inputs").GetProperty("sourcePdf").GetProperty("sha256").GetString()
                .Should().Be(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(sourcePath))).ToLowerInvariant());
            retainedWorkRoot = receipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowFailureReceiptPreservesNodeDiagnostics()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowNodeFailure", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(fakeNodeDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "node.cmd"),
            "@echo off\r\npwsh -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake-node.ps1\" %*\r\nexit /b %ERRORLEVEL%\r\n");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "fake-node.ps1"),
            """
            $ErrorActionPreference = "Stop"
            $tool = [IO.Path]::GetFileName($args[0])
            $toolArgs = @($args | Select-Object -Skip 1)
            function Get-Option([string]$Name) {
                for ($index = 0; $index -lt $toolArgs.Count - 1; $index++) {
                    if ($toolArgs[$index] -eq $Name) { return $toolArgs[$index + 1] }
                }
                return $null
            }
            switch ($tool) {
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    [IO.Directory]::CreateDirectory($out) | Out-Null
                    [IO.File]::WriteAllText((Join-Path $out "exam.page-1.png"), "png")
                    [IO.File]::WriteAllText((Join-Path $out "manifest.json"), '{"pages":[{}]}')
                }
                "answer-request.mjs" {
                    [Console]::Error.WriteLine("provider diagnostics: status=503; attemptedRoles=primary,fallback_1")
                    exit 1
                }
                "validate-json.mjs" { exit 0 }
                default { throw "Unexpected fake node tool: $tool" }
            }
            """);

        try
        {
            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = pathValue },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-SkipVisualAudit");

            result.ExitCode.Should().NotBe(0, result.Output);
            var receiptText = File.ReadAllText(receiptPath);
            using var document = JsonDocument.Parse(receiptText);
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("failed");
            receipt.GetProperty("phases").GetProperty("blindGeneration").GetProperty("error").GetString()
                .Should().Contain("status=503");
            receipt.GetProperty("error").GetString().Should().Contain("attemptedRoles=primary,fallback_1");
            retainedWorkRoot = receipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowResumesHashBoundBlindCandidateWithoutRepeatingGeneration()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowResume", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var failedDirectory = Path.Combine(testRoot, "failed");
        var resumedDirectory = Path.Combine(testRoot, "resumed");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var candidatePath = Path.Combine(failedDirectory, "exam盲答候选.md");
        var summaryPath = Path.Combine(failedDirectory, "exam.blind-generation.summary.json");
        var failedReceiptPath = Path.Combine(failedDirectory, "exam.workflow-run.json");
        Directory.CreateDirectory(fakeNodeDirectory);
        Directory.CreateDirectory(failedDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-reference");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        File.WriteAllText(candidatePath, "# 已完成的盲答\n");
        File.WriteAllText(summaryPath, "{\"kind\":\"live-answer-generation-summary\"}");

        Dictionary<string, object> FileReceipt(string path)
        {
            var bytes = File.ReadAllBytes(path);
            return new Dictionary<string, object>
            {
                ["path"] = path,
                ["bytes"] = bytes.Length,
                ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
        }

        var priorReceipt = new Dictionary<string, object?>
        {
            ["kind"] = "live-answer-workflow-run",
            ["status"] = "failed",
            ["inputs"] = new Dictionary<string, object?>
            {
                ["sourcePdf"] = FileReceipt(sourcePath),
                ["referencePdf"] = FileReceipt(referencePath),
                ["prompt"] = FileReceipt(promptPath),
                ["blindFocusRegions"] = null,
                ["visualAuditFocusRegions"] = null
            },
            ["phases"] = new Dictionary<string, object>
            {
                ["blindGeneration"] = new Dictionary<string, object>
                {
                    ["status"] = "completed",
                    ["summary"] = FileReceipt(summaryPath),
                    ["artifact"] = FileReceipt(candidatePath)
                }
            }
        };
        File.WriteAllText(failedReceiptPath, JsonSerializer.Serialize(priorReceipt));
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "node.cmd"),
            "@echo off\r\npwsh -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake-node.ps1\" %*\r\nexit /b %ERRORLEVEL%\r\n");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "fake-node.ps1"),
            """
            $ErrorActionPreference = "Stop"
            $tool = [IO.Path]::GetFileName($args[0])
            $toolArgs = @($args | Select-Object -Skip 1)
            function Get-Option([string]$Name) {
                for ($index = 0; $index -lt $toolArgs.Count - 1; $index++) {
                    if ($toolArgs[$index] -eq $Name) { return $toolArgs[$index + 1] }
                }
                return $null
            }
            function Write-Text([string]$PathValue, [string]$Value) {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PathValue))) | Out-Null
                [IO.File]::WriteAllText([IO.Path]::GetFullPath($PathValue), $Value, [Text.UTF8Encoding]::new($false))
            }
            switch ($tool) {
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    Write-Text (Join-Path $out "source.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                }
                "answer-request.mjs" {
                    $output = Get-Option "--output"
                    if ($output -like "*盲答候选.md") { throw "blind generation must not be called during resume" }
                    Write-Text $output "# 物理试卷参考答案`n"
                    Write-Text (Get-Option "--summary-out") '{"kind":"live-answer-generation-summary"}'
                }
                "answer-diff-report.mjs" { Write-Text $toolArgs[2] "# diff`n" }
                "deliver-answer.mjs" {
                    $pdf = [IO.Path]::GetFullPath($toolArgs[1])
                    $base = Join-Path ([IO.Path]::GetDirectoryName($pdf)) ([IO.Path]::GetFileNameWithoutExtension($pdf))
                    Write-Text $pdf "%PDF-delivery"
                    Write-Text ($base + ".snapshot.json") '{"snapshotId":"test"}'
                    Write-Text ($base + ".delivery-manifest.json") '{"kind":"delivery-manifest"}'
                }
                "validate-json.mjs" { exit 0 }
                default { throw "Unexpected fake node tool: $tool" }
            }
            """);

        try
        {
            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = pathValue },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", resumedDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-ResumeFromWorkflowReceipt", failedReceiptPath,
                "-SkipVisualAudit");

            result.ExitCode.Should().Be(0, result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(resumedDirectory, "exam.workflow-run.json")));
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("succeeded");
            receipt.GetProperty("phases").GetProperty("blindGeneration").GetProperty("artifact").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(candidatePath)["sha256"].ToString());
            receipt.GetProperty("resume").GetProperty("workflowReceipt").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(failedReceiptPath)["sha256"].ToString());
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowWritesSuccessReceiptAndBlocksPromptDrift()
    {
        var root = FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowSuccess", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(fakeNodeDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "node.cmd"),
            "@echo off\r\npwsh -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake-node.ps1\" %*\r\nexit /b %ERRORLEVEL%\r\n");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "fake-node.ps1"),
            """
            $ErrorActionPreference = "Stop"
            $tool = [IO.Path]::GetFileName($args[0])
            $toolArgs = @($args | Select-Object -Skip 1)
            function Get-Option([string]$Name) {
                for ($index = 0; $index -lt $toolArgs.Count - 1; $index++) {
                    if ($toolArgs[$index] -eq $Name) { return $toolArgs[$index + 1] }
                }
                return $null
            }
            function Write-Text([string]$PathValue, [string]$Value) {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PathValue))) | Out-Null
                [IO.File]::WriteAllText([IO.Path]::GetFullPath($PathValue), $Value, [Text.UTF8Encoding]::new($false))
            }
            switch ($tool) {
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    [IO.Directory]::CreateDirectory($out) | Out-Null
                    Write-Text (Join-Path $out "source.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                    if ($env:CLASSROOM_TOOLKIT_TEST_MUTATE_PROMPT -eq "true") {
                        Write-Text $env:CLASSROOM_TOOLKIT_TEST_PROMPT_PATH "# mutated prompt"
                    }
                }
                "answer-request.mjs" {
                    Write-Text (Get-Option "--output") "# 物理试卷参考答案`n"
                    Write-Text (Get-Option "--summary-out") '{"kind":"live-answer-generation-summary"}'
                }
                "answer-diff-report.mjs" {
                    Write-Text $toolArgs[2] "# diff`n"
                }
                "deliver-answer.mjs" {
                    $pdf = [IO.Path]::GetFullPath($toolArgs[1])
                    $base = Join-Path ([IO.Path]::GetDirectoryName($pdf)) ([IO.Path]::GetFileNameWithoutExtension($pdf))
                    Write-Text $pdf "%PDF-delivery"
                    Write-Text ($base + ".snapshot.json") '{"snapshotId":"test"}'
                    Write-Text ($base + ".delivery-manifest.json") '{"kind":"delivery-manifest"}'
                }
                "validate-json.mjs" {
                    # Receipt schema fidelity is asserted by the rule-compiler
                    # receipt fixture tests; the fake only proves the call path.
                    exit 0
                }
                default { throw "Unexpected fake node tool: $tool" }
            }
            """);

        try
        {
            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = pathValue },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-SkipVisualAudit");

            result.ExitCode.Should().Be(0, result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(receiptPath));
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("succeeded");
            var phases = receipt.GetProperty("phases");
            phases.GetProperty("blindGeneration").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("visualFindings").GetProperty("status").GetString().Should().Be("skipped");
            phases.GetProperty("referenceReview").GetProperty("status").GetString().Should().Be("skipped");
            phases.GetProperty("delivery").GetProperty("status").GetString().Should().Be("completed");
            receipt.GetProperty("artifacts").GetArrayLength().Should().Be(7);

            var driftOutputDirectory = Path.Combine(testRoot, "drift-delivery");
            var driftReceiptPath = Path.Combine(driftOutputDirectory, "exam.workflow-run.json");
            File.WriteAllText(promptPath, "# frozen prompt");
            var frozenPromptSha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(promptPath))).ToLowerInvariant();
            var driftResult = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    ["PATH"] = pathValue,
                    ["CLASSROOM_TOOLKIT_TEST_MUTATE_PROMPT"] = "true",
                    ["CLASSROOM_TOOLKIT_TEST_PROMPT_PATH"] = promptPath
                },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", driftOutputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-SkipVisualAudit");

            driftResult.ExitCode.Should().NotBe(0);
            driftResult.Output.Should().Contain("Workflow input drift detected for PromptFile");
            using var driftDocument = JsonDocument.Parse(File.ReadAllText(driftReceiptPath));
            var driftReceipt = driftDocument.RootElement;
            driftReceipt.GetProperty("status").GetString().Should().Be("failed");
            driftReceipt.GetProperty("inputs").GetProperty("prompt").GetProperty("sha256").GetString()
                .Should().Be(frozenPromptSha);
            retainedWorkRoot = driftReceipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    private static async Task<ProcessResult> RunAsync(string fileName, string workingDirectory, params string[] arguments)
    {
        return await RunAsyncWithEnvironment(fileName, workingDirectory, environment: null, arguments);
    }

    private static void CreateTransferPackage(
        string packagePath,
        IReadOnlyDictionary<string, string> files,
        params string[] manifestPaths)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(packagePath)!);
        using var archive = ZipFile.Open(packagePath, ZipArchiveMode.Create);
        foreach (var (relativePath, content) in files)
        {
            WriteZipEntry(archive, relativePath, Encoding.UTF8.GetBytes(content));
        }

        var manifestFiles = manifestPaths.Select(relativePath =>
        {
            var bytes = Encoding.UTF8.GetBytes(files[relativePath]);
            return new
            {
                path = relativePath,
                bytes = bytes.LongLength,
                sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
        }).ToArray();
        var manifest = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "1.0",
            kind = "classroom-toolkit-transfer",
            mode = "PrivateDev",
            sourceCommit = new string('a', 40),
            envIncluded = false,
            gitIncluded = false,
            publishedAppIncluded = false,
            files = manifestFiles
        });
        WriteZipEntry(archive, "transfer-manifest.json", manifest);
    }

    private static void WriteZipEntry(ZipArchive archive, string relativePath, byte[] content)
    {
        var entry = archive.CreateEntry(relativePath, CompressionLevel.Fastest);
        using var stream = entry.Open();
        stream.Write(content);
    }

    private static async Task<ProcessResult> RunAsyncWithEnvironment(
        string fileName,
        string workingDirectory,
        IReadOnlyDictionary<string, string?>? environment,
        params string[] arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        if (environment is not null)
        {
            foreach (var (key, value) in environment) startInfo.Environment[key] = value;
        }
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Unable to start {fileName}.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"{fileName} did not exit within two minutes.");
        }

        var output = (await stdoutTask) + Environment.NewLine + (await stderrTask);
        return new ProcessResult(process.ExitCode, output);
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))) return current.FullName;
            current = current.Parent;
        }

        throw new InvalidOperationException("Repository root not found.");
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}
