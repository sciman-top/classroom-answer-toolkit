namespace ClassroomToolkit.Domain.Toolchain;

public sealed record ToolchainExecutionResult(
    ToolchainScriptKind Kind,
    string ScriptPath,
    int ExitCode,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    string Output)
{
    public TimeSpan Duration => FinishedAt - StartedAt;

    public bool Succeeded => ExitCode == 0;

    public static ToolchainExecutionResult Success(
        ToolchainScriptKind kind,
        string scriptPath,
        DateTimeOffset startedAt,
        DateTimeOffset finishedAt,
        string output)
    {
        return new ToolchainExecutionResult(kind, scriptPath, 0, startedAt, finishedAt, output);
    }

    public static ToolchainExecutionResult Failure(
        ToolchainScriptKind kind,
        string scriptPath,
        int exitCode,
        DateTimeOffset startedAt,
        DateTimeOffset finishedAt,
        string output)
    {
        return new ToolchainExecutionResult(kind, scriptPath, exitCode, startedAt, finishedAt, output);
    }
}
