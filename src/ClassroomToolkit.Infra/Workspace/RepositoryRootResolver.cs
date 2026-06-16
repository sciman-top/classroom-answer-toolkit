using ClassroomToolkit.Infra.Abstractions;

namespace ClassroomToolkit.Infra.Workspace;

public sealed class RepositoryRootResolver : IRepositoryRootResolver
{
    private readonly string _startDirectory;

    public RepositoryRootResolver(string? startDirectory = null)
    {
        _startDirectory = startDirectory ?? AppContext.BaseDirectory;
    }

    public string ResolveRepositoryRoot()
    {
        var current = new DirectoryInfo(_startDirectory);
        while (current is not null)
        {
            if (IsRepositoryRoot(current.FullName))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return _startDirectory;
    }

    private static bool IsRepositoryRoot(string directoryPath)
    {
        return File.Exists(Path.Combine(directoryPath, "global.json"))
            && File.Exists(Path.Combine(directoryPath, "ClassroomToolkit.sln"))
            && Directory.Exists(Path.Combine(directoryPath, "scripts"));
    }
}
