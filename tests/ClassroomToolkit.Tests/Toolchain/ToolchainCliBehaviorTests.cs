using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

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
            snapshot.GetProperty("subjectPack").GetProperty("version").GetString().Should().Be("v8.16");
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
            receipt.GetProperty("artifacts").GetArrayLength().Should().Be(4);

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
