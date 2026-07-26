using ClassroomToolkit.Infra.Process;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Infra;

public sealed class PowerShellProcessRunnerTests
{
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
