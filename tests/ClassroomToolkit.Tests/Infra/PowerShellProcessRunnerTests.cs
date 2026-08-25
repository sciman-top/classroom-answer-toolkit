using System.Diagnostics;
using ClassroomToolkit.Infra.Process;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Infra;

public sealed class PowerShellProcessRunnerTests
{
    [Fact]
    public async Task RunAsync_StartsNodeExecutableOnWindows()
    {
        var runner = new PowerShellProcessRunner();

        var result = await runner.RunAsync(
            "node",
            ["--version"],
            Path.GetTempPath());

        result.ExitCode.Should().Be(0, result.StandardError);
        result.StandardOutput.Trim().Should().StartWith("v");
    }

    [Fact]
    public async Task RunAsync_DoesNotStartProcess_WhenAlreadyCanceled()
    {
        var runner = new PowerShellProcessRunner();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        var action = () => runner.RunAsync(
            $"missing-executable-{Guid.NewGuid():N}",
            [],
            Path.GetTempPath(),
            cancellation.Token);

        await action.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task RunAsync_ReportsMissingExecutableAsActionableDiagnostic()
    {
        var runner = new PowerShellProcessRunner();

        var action = () => runner.RunAsync(
            $"missing-executable-{Guid.NewGuid():N}",
            [],
            Path.GetTempPath());

        (await action.Should().ThrowAsync<InvalidOperationException>())
            .Which.Message.Should().Contain("未找到可执行文件");
    }

    [Fact]
    public async Task RunAsync_TerminatesHungProcessAfterTimeout()
    {
        var runner = new PowerShellProcessRunner();
        var clock = Stopwatch.StartNew();
        var action = () => runner.RunAsync(
            "pwsh",
            ["-NoProfile", "-Command", "Start-Sleep -Seconds 30"],
            Path.GetTempPath(),
            timeout: TimeSpan.FromMilliseconds(500));

        (await action.Should().ThrowAsync<TimeoutException>())
            .Which.Message.Should().Contain("exceeded").And.Contain("pwsh").And.Contain("terminated");
        clock.Stop();
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(15));
    }
}
