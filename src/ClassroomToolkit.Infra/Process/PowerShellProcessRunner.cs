using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;
using ClassroomToolkit.Infra.Abstractions;

namespace ClassroomToolkit.Infra.Process;

public sealed class PowerShellProcessRunner : IProcessRunner
{
    public async Task<ProcessRunResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken = default,
        TimeSpan? timeout = null)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // pwsh and node emit UTF-8; without this the host code page (GBK on zh-CN)
            // garbles Chinese file names in captured diagnostics.
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new System.Diagnostics.Process { StartInfo = startInfo };
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            if (!process.Start())
            {
                throw new InvalidOperationException($"Failed to start process: {fileName}");
            }
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode is 2 or 3)
        {
            // A missing pwsh/node is the most likely teacher-machine failure; turn the
            // bare Win32 error into an actionable diagnostic instead of a crash.
            throw new InvalidOperationException(
                $"未找到可执行文件 {fileName}（Win32 错误 {ex.NativeErrorCode}）。"
                + "请先安装它并确认已加入 PATH（pwsh 需要 PowerShell 7+，node 需要 Node.js 18+）。",
                ex);
        }

        using var timeoutCts = timeout is null ? null : new CancellationTokenSource(timeout.Value);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            timeoutCts?.Token ?? CancellationToken.None);
        using var registration = linkedCts.Token.Register(() =>
        {
            // Cancel() runs this callback inline on the caller's thread — the UI
            // thread when the Cancel button fires it. Kill(entireProcessTree)
            // enumerates a node→headless-browser tree and can block for hundreds
            // of milliseconds, so the kill itself runs on the thread pool. The
            // whole body stays inside the try: RunAsync may have already
            // returned and disposed the Process by the time the pool thread
            // runs, and the catch keeps that deferred task's exception observed.
            _ = Task.Run(() =>
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
                catch (Exception ex) when (ex is ObjectDisposedException
                    or InvalidOperationException
                    or System.ComponentModel.Win32Exception)
                {
                    // The process exited (and was disposed) before the pool
                    // thread got here; there is nothing left to kill.
                }
            });
        });

        var standardOutputTask = process.StandardOutput.ReadToEndAsync(linkedCts.Token);
        var standardErrorTask = process.StandardError.ReadToEndAsync(linkedCts.Token);
        try
        {
            // ConfigureAwait(false) is load-bearing: callers such as the WPF health
            // surface may block a Dispatcher thread on this task, and any continuation
            // posted back to a non-pumping Dispatcher context deadlocks.
            await process.WaitForExitAsync(linkedCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (IsTimeout())
        {
            // Cancellation callbacks are scheduled asynchronously.  Do not let
            // disposal of the registration race ahead of the callback and leave
            // the timed-out child alive (which also keeps its output pipe open).
            TryKillEntireTree(process);
            throw TimeoutException();
        }
        catch (OperationCanceledException)
        {
            // Caller cancellation has the same process-lifecycle requirement as
            // the timeout path: returning control must not leave a tool running.
            TryKillEntireTree(process);
            throw;
        }

        if (IsTimeout())
        {
            // The kill can race ahead of the linked token: the process exited, but
            // because the deadline passed, not because the work finished.
            throw TimeoutException();
        }

        string standardOutput;
        string standardError;
        try
        {
            // An orphaned grandchild holding the pipe can keep ReadToEnd alive after
            // the parent exited; the deadline (or caller cancellation) must still win.
            standardOutput = await standardOutputTask.WaitAsync(linkedCts.Token).ConfigureAwait(false);
            standardError = await standardErrorTask.WaitAsync(linkedCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (IsTimeout())
        {
            // The parent is gone but a grandchild may still own the pipe.
            TryKillEntireTree(process);
            throw TimeoutException();
        }

        return new ProcessRunResult(
            process.ExitCode,
            standardOutput,
            standardError);

        bool IsTimeout() =>
            timeoutCts is not null
            && timeoutCts.IsCancellationRequested
            && !cancellationToken.IsCancellationRequested;

        static void TryKillEntireTree(System.Diagnostics.Process target)
        {
            try
            {
                if (!target.HasExited)
                {
                    target.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Best effort cleanup only.
            }
        }

        TimeoutException TimeoutException() => new(
            $"Process exceeded the {timeout!.Value.TotalMinutes:0.#} minute limit and was terminated: {fileName}");
    }
}
