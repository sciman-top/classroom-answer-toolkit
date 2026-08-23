using System.Diagnostics;
using FluentAssertions;
using Xunit;

namespace ClassroomToolkit.Tests.Toolchain;

[Trait("Gate", "ToolchainIntegration")]
public sealed class ArchiveDeliveryRunScriptTests
{
    [Fact]
    public async Task RejectsRunDirectoriesOutsideTheDeliveriesRoot()
    {
        var (sandbox, _, scriptPath) = CreateSandbox();
        try
        {
            var siblingRun = Path.Combine(sandbox, "正式交付-fake", "run-b");
            var result = await RunScriptAsync(scriptPath, sandbox, Path.Combine(sandbox, "archive-own"),
                siblingRun);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("must be a direct child");
            Directory.Exists(Path.Combine(sandbox, "archive-own", "正式交付", "run-b")).Should().BeFalse();
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RejectsReArchiveWhenPayloadDriftedFromManifestHash()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            var archiveRoot = Path.Combine(sandbox, "archive-drift");
            var first = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);
            first.ExitCode.Should().Be(0);
            File.ReadAllLines(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt")).Should().HaveCount(3);

            DeleteDirectory(Path.Combine(archiveRoot, "正式交付", "run-a"));
            File.WriteAllText(Path.Combine(runDirectory, "file-1.md"), "drifted content");

            var second = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);

            second.ExitCode.Should().NotBe(0);
            second.Output.Should().Contain("drifted from the manifest hash");
            Directory.Exists(Path.Combine(archiveRoot, "正式交付", "run-a")).Should().BeFalse();
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RollsBackPartialArchiveWhenCopyFailsMidRun()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        FileStream? lockStream = null;
        try
        {
            var archiveRoot = Path.Combine(sandbox, "archive-rollback");
            lockStream = new FileStream(
                Path.Combine(runDirectory, "file-2.json"),
                FileMode.Open, FileAccess.Read, FileShare.None);

            var failed = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);

            failed.ExitCode.Should().NotBe(0);
            Directory.Exists(Path.Combine(archiveRoot, "正式交付", "run-a")).Should().BeFalse();

            lockStream.Dispose();
            lockStream = null;

            var retried = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);
            retried.ExitCode.Should().Be(0);
            File.ReadAllLines(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt")).Should().HaveCount(3);
        }
        finally
        {
            lockStream?.Dispose();
            DeleteDirectory(sandbox);
        }
    }

    private static (string Sandbox, string RunDirectory, string ScriptPath) CreateSandbox()
    {
        var root = FindRepoRoot();
        var sandbox = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ArchiveScript", Guid.NewGuid().ToString("N"));
        var runDirectory = Path.Combine(sandbox, "正式交付", "run-a");
        Directory.CreateDirectory(Path.Combine(runDirectory, "sub"));
        File.WriteAllText(Path.Combine(runDirectory, "file-1.md"), "answer markdown");
        File.WriteAllText(Path.Combine(runDirectory, "file-2.json"), "{\"ok\":true}");
        File.WriteAllText(Path.Combine(runDirectory, "sub", "page.pdf"), "%PDF-page");
        var sibling = Path.Combine(sandbox, "正式交付-fake", "run-b");
        Directory.CreateDirectory(sibling);
        File.WriteAllText(Path.Combine(sibling, "x.md"), "sibling");
        return (sandbox, runDirectory, Path.Combine(root, "scripts", "archive-delivery-run.ps1"));
    }

    private static async Task<ProcessResult> RunScriptAsync(string scriptPath, string repositoryRoot, string archiveRoot, string runDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "pwsh",
            WorkingDirectory = Path.GetTempPath(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add("-RepositoryRoot");
        startInfo.ArgumentList.Add(repositoryRoot);
        startInfo.ArgumentList.Add("-ArchiveRoot");
        startInfo.ArgumentList.Add(archiveRoot);
        startInfo.ArgumentList.Add("-RunDirectory");
        startInfo.ArgumentList.Add(runDirectory);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Unable to start pwsh.");
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
            throw new TimeoutException("pwsh did not exit within two minutes.");
        }

        return new ProcessResult(process.ExitCode, (await stdoutTask) + Environment.NewLine + (await stderrTask));
    }

    private static void DeleteDirectory(string directory)
    {
        if (!Directory.Exists(directory))
        {
            return;
        }
        foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
        {
            File.SetAttributes(file, FileAttributes.Normal);
        }
        Directory.Delete(directory, recursive: true);
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))) return current.FullName;
            current = current.Parent!;
        }

        throw new InvalidOperationException("Repository root not found.");
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}
