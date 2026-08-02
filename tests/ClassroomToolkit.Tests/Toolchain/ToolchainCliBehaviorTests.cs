using System.Diagnostics;
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
            snapshot.GetProperty("subjectPack").GetProperty("version").GetString().Should().Be("v8.15");
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
    public async Task FastGateExecutesFastStepsAndSkipsCoreWork()
    {
        var result = await RunAsync(
            "pwsh",
            FindRepoRoot(),
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "scripts/check-toolchain.ps1",
            "-Mode", "Fast");

        result.ExitCode.Should().Be(0, result.Output);
        result.Output.Should().Contain("mode: Fast");
        result.Output.Should().Contain("spec-boundary");
        result.Output.Should().Contain("ai-answer-tests");
        result.Output.Should().Contain("skipped: assets");
        result.Output.Should().Contain("delivery-smoke");
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

    private static async Task<ProcessResult> RunAsync(string fileName, string workingDirectory, params string[] arguments)
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
