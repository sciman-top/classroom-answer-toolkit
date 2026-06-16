namespace ClassroomToolkit.Infra.Abstractions;

public interface IProcessRunner
{
    Task<ProcessRunResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken = default);
}

public sealed record ProcessRunResult(
    int ExitCode,
    string StandardOutput,
    string StandardError,
    TimeSpan Duration);
