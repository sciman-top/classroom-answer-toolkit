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
    public async Task RunAsync_CancelAfterStart_KillsChildWithoutUnobservedExceptions()
    {
        // Regression for the 2026-08-29 review: the cancel callback hands the
        // process-tree kill to a thread-pool task, and RunAsync can return and
        // dispose the Process before that task runs. The kill body must keep
        // its own exception handling so the deferred task never faults
        // unobserved, and immediate cancellation must still terminate the tree.
        var unobservedExceptions = new List<Exception>();
        void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs eventArgs)
        {
            lock (unobservedExceptions)
            {
                unobservedExceptions.Add(eventArgs.Exception);
            }
        }

        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        try
        {
            for (var iteration = 0; iteration < 5; iteration += 1)
            {
                var runner = new PowerShellProcessRunner();
                var processIdPath = Path.Combine(Path.GetTempPath(), $"runner-cancel-{Guid.NewGuid():N}.pid");
                using var cancellation = new CancellationTokenSource();
                try
                {
                    var runTask = runner.RunAsync(
                        "node",
                        [
                            "-e",
                            $"require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {{}}, 30000)",
                            processIdPath
                        ],
                        Path.GetTempPath(),
                        cancellation.Token);

                    var processId = await WaitForPidFileAsync(processIdPath, TimeSpan.FromSeconds(5));
                    cancellation.Cancel();
                    await FluentActions.Awaiting(() => runTask)
                        .Should().ThrowAsync<OperationCanceledException>();
                    (await WaitForProcessExitAsync(processId, TimeSpan.FromSeconds(5)))
                        .Should().BeTrue("an immediate cancel must still terminate the started child");
                }
                finally
                {
                    File.Delete(processIdPath);
                }
            }

            // Give finalizers a chance to surface any unobserved task fault.
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            lock (unobservedExceptions)
            {
                unobservedExceptions.Should().BeEmpty();
            }
        }
        finally
        {
            TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;
        }
    }

    [Fact]
    public async Task RunAsync_TerminatesHungProcessAfterTimeout()
    {
        var runner = new PowerShellProcessRunner();
        var clock = Stopwatch.StartNew();
        var processIdPath = Path.Combine(Path.GetTempPath(), $"runner-timeout-{Guid.NewGuid():N}.pid");
        int? processId = null;
        try
        {
            var action = () => runner.RunAsync(
                "pwsh",
                [
                    "-NoProfile",
                    "-Command",
                    $"Set-Content -LiteralPath '{processIdPath.Replace("'", "''")}' -Value $PID; Start-Sleep -Seconds 30"
                ],
                Path.GetTempPath(),
                timeout: TimeSpan.FromMilliseconds(500));

            (await action.Should().ThrowAsync<TimeoutException>())
                .Which.Message.Should().Contain("exceeded").And.Contain("pwsh").And.Contain("terminated");
            processId = await WaitForPidFileAsync(processIdPath, TimeSpan.FromSeconds(5));
            (await WaitForProcessExitAsync(processId.Value, TimeSpan.FromSeconds(5))).Should().BeTrue("a timeout must terminate the child process");
            clock.Stop();
            clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(15));
        }
        finally
        {
            if (processId is int knownProcessId)
            {
                StopProcessIfRunning(knownProcessId);
            }
            File.Delete(processIdPath);
        }
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

    [Fact]
    public async Task RunAsync_TimesOut_WhenAnOrphanGrandchildHoldsTheOutputPipe()
    {
        // Regression for 2026-08-26 audit P2: a detached grandchild inheriting our
        // redirected stdout keeps ReadToEnd alive forever after the parent exited;
        // the deadline must still terminate the wait instead of hanging.
        var runner = new PowerShellProcessRunner();
        var clock = Stopwatch.StartNew();
        var orphanScript = Path.Combine(Path.GetTempPath(), $"orphan-{Guid.NewGuid():N}.js");
        var orphanPidPath = Path.Combine(Path.GetTempPath(), $"orphan-{Guid.NewGuid():N}.pid");
        await File.WriteAllTextAsync(orphanScript,
            "const child = require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:['ignore','inherit','inherit']});"
            + $"require('node:fs').writeFileSync('{orphanPidPath.Replace("\\", "\\\\").Replace("'", "\\'")}', String(child.pid));child.unref();");
        try
        {
            var action = () => runner.RunAsync(
                "node",
                ["-e", $"require('{orphanScript.Replace("\\", "\\\\")}');setTimeout(()=>{{}},120000)"],
                Path.GetTempPath(),
                timeout: TimeSpan.FromSeconds(3));

            (await action.Should().ThrowAsync<TimeoutException>())
                .Which.Message.Should().Contain("exceeded").And.Contain("terminated");
            clock.Stop();
            clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(15));
        }
        finally
        {
            if (File.Exists(orphanPidPath) && int.TryParse(await File.ReadAllTextAsync(orphanPidPath), out var orphanProcessId))
            {
                StopProcessIfRunning(orphanProcessId);
                await WaitForProcessExitAsync(orphanProcessId, TimeSpan.FromSeconds(5));
            }
            File.Delete(orphanScript);
            File.Delete(orphanPidPath);
        }
    }

    // A cold pwsh start (AV scan, first-run JIT) can lag the 500ms timeout by a
    // lot before the script writes its pid, so poll instead of reading once.
    private static async Task<int> WaitForPidFileAsync(string path, TimeSpan timeout)
    {
        var deadline = Stopwatch.GetTimestamp() + (long)(timeout.TotalSeconds * Stopwatch.Frequency);
        while (Stopwatch.GetTimestamp() < deadline)
        {
            try
            {
                return int.Parse(await File.ReadAllTextAsync(path));
            }
            catch (Exception ex) when (ex is FileNotFoundException
                or DirectoryNotFoundException
                or IOException
                or FormatException)
            {
                // Missing, mid-write, or still empty: keep polling.
                await Task.Delay(50);
            }
        }

        throw new TimeoutException($"pid file was not written within {timeout.TotalSeconds:0.#}s: {path}");
    }

    private static async Task<bool> WaitForProcessExitAsync(int processId, TimeSpan timeout)
    {
        var deadline = Stopwatch.GetTimestamp() + (long)(timeout.TotalSeconds * Stopwatch.Frequency);
        while (Stopwatch.GetTimestamp() < deadline)
        {
            try
            {
                using var process = Process.GetProcessById(processId);
                // GetProcessById can return an unrelated process when Windows
                // recycled the pid; only a live pwsh still counts as running.
                if (!IsAlivePowershellProcess(process))
                {
                    return true;
                }
            }
            catch (ArgumentException)
            {
                return true;
            }

            await Task.Delay(50);
        }

        return false;
    }

    private static bool IsAlivePowershellProcess(Process process)
    {
        try
        {
            if (process.HasExited)
            {
                return false;
            }

            return process.ProcessName.StartsWith("pwsh", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Exit state raced the query; treat it as gone.
            return false;
        }
    }

    private static void StopProcessIfRunning(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            if (IsAlivePowershellProcess(process))
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (ArgumentException)
        {
            // The expected teardown state is already reached.
        }
    }
}
