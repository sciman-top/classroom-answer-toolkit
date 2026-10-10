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

    internal sealed record ProcessResult(int ExitCode, string Output)
    {
        // See ToolchainProcessOutput: ANSI escapes, the error-frame gutter and
        // path-length-dependent wrapping all break naive message assertions.
        public string NormalizedOutput => ToolchainProcessOutput.Normalize(Output);
    }
}
