namespace ClassroomToolkit.Tests.Toolchain;

// Shared plumbing for the script/CLI contract tests: locating the repository
// from the test output directory, and carrying a child process's exit state
// with normalized output for message assertions.
internal static class ToolchainTestHost
{
    internal static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))) return current.FullName;
            current = current.Parent;
        }

        throw new InvalidOperationException("Repository root not found.");
    }

    internal static string FindExecutableOnPath(string executableName)
    {
        const string extensions = ".EXE;.CMD;.BAT;.COM";
        var pathDirectories = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var directory in pathDirectories)
        {
            var candidate = Path.Combine(directory, executableName);
            if (Path.HasExtension(executableName))
            {
                if (File.Exists(candidate)) return candidate;
            }
            else
            {
                foreach (var extension in extensions.Split(';'))
                {
                    candidate = Path.Combine(directory, executableName + extension);
                    if (File.Exists(candidate)) return candidate;
                }
            }
        }

        throw new InvalidOperationException($"{executableName} not found on PATH.");
    }

    internal static string? FindExecutableOnPathOrNull(string executableName)
    {
        try
        {
            return FindExecutableOnPath(executableName);
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    internal sealed record ProcessResult(int ExitCode, string Output)
    {
        // See ToolchainProcessOutput: ANSI escapes, the error-frame gutter and
        // path-length-dependent wrapping all break naive message assertions.
        public string NormalizedOutput => ToolchainProcessOutput.Normalize(Output);
    }

}
