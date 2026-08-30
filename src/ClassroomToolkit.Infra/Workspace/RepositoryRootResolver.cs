namespace ClassroomToolkit.Infra.Workspace;

public sealed class RepositoryRootResolver
{
    private readonly string _startDirectory;
    private readonly string? _repositoryRootOverride;

    public RepositoryRootResolver(string? startDirectory = null, string? repositoryRootOverride = null)
    {
        _startDirectory = startDirectory ?? AppContext.BaseDirectory;
        _repositoryRootOverride = string.IsNullOrWhiteSpace(repositoryRootOverride)
            ? null
            : Path.GetFullPath(repositoryRootOverride);
    }

    public string ResolveRepositoryRoot()
    {
        if (!string.IsNullOrWhiteSpace(_repositoryRootOverride) && IsWorkspaceRoot(_repositoryRootOverride))
        {
            return _repositoryRootOverride;
        }

        var current = new DirectoryInfo(_startDirectory);
        while (current is not null)
        {
            if (IsWorkspaceRoot(current.FullName))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return _startDirectory;
    }

    private static bool IsWorkspaceRoot(string directoryPath)
    {
        var isDevelopmentRepository = File.Exists(Path.Combine(directoryPath, "global.json"))
            && File.Exists(Path.Combine(directoryPath, "ClassroomToolkit.sln"))
            && Directory.Exists(Path.Combine(directoryPath, "scripts"));
        var isPackagedRuntime = File.Exists(Path.Combine(directoryPath, "runtime-manifest.json"))
            && Directory.Exists(Path.Combine(directoryPath, "tools"))
            && Directory.Exists(Path.Combine(directoryPath, "prompts"))
            && File.Exists(Path.Combine(directoryPath, "runtime", "node", "node.exe"));

        return isDevelopmentRepository || isPackagedRuntime;
    }
}
