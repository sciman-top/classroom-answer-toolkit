using System.Diagnostics;
using System.Threading;
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

    [Fact]
    public async Task RunAsync_Completes_WhenBlockedOnANonPumpingDispatcherThread()
    {
        // Regression for the WPF startup deadlock (2026-08-26 audit, P1): blocking a
        // Dispatcher thread on RunAsync deadlocked whenever any continuation was
        // posted back to the captured Dispatcher context, because that context was
        // not pumping. The runner must not capture the caller's context. Before the
        // fix this test times out instead of failing fast: the worker thread stays
        // blocked on GetResult until the test process ends.
        var runner = new PowerShellProcessRunner();
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                // Mirror the WPF UI thread: an STA thread with a Dispatcher
                // synchronization context that never runs a message pump.
                var dispatcher = System.Windows.Threading.Dispatcher.CurrentDispatcher;
                SynchronizationContext.SetSynchronizationContext(
                    new System.Windows.Threading.DispatcherSynchronizationContext(dispatcher));

                var result = runner.RunAsync(
                    "node",
                    ["-e", "setTimeout(() => console.log('ok'), 300)"],
                    Path.GetTempPath()).GetAwaiter().GetResult();
                completion.TrySetResult(result.StandardOutput.Trim());
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        var output = await completion.Task.WaitAsync(TimeSpan.FromSeconds(30));
        output.Should().Be("ok");
    }
}
