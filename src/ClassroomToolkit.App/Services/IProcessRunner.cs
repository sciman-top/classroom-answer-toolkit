namespace ClassroomToolkit.App.Services;

public interface IProcessRunner
{
    /// <summary>
    /// Runs a child process and captures its output.
    /// </summary>
    /// <param name="onOutputLine">
    /// Optional per-line sink for stdout/stderr, invoked as lines arrive while
    /// the child is still running (long toolchains would otherwise look hung).
    /// Callbacks run on thread-pool threads and must not touch UI state directly.
    /// </param>
    Task<ProcessRunResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken = default,
        TimeSpan? timeout = null,
        Action<string>? onOutputLine = null);
}

public sealed record ProcessRunResult(
    int ExitCode,
    string StandardOutput,
    string StandardError);
