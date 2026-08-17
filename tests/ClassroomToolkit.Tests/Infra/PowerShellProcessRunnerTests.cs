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
}
