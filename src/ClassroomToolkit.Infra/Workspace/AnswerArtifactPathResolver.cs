namespace ClassroomToolkit.Infra.Workspace;

public static class AnswerArtifactPathResolver
{
    public static string ResolveOutputPdfPath(string answerMarkdownPath, string? explicitOutputPdfPath, string? baseDirectory = null)
    {
        if (!string.IsNullOrWhiteSpace(explicitOutputPdfPath))
        {
            return baseDirectory is null
                ? Path.GetFullPath(explicitOutputPdfPath)
                : ResolveUserPath(explicitOutputPdfPath, baseDirectory);
        }

        return Path.ChangeExtension(Path.GetFullPath(answerMarkdownPath), ".pdf");
    }

    // Relative user input must not depend on the launcher's CWD (a WinExE
    // started from Explorer can run in System32); resolve against a stable
    // base such as the workspace root instead.
    public static string ResolveUserPath(string path, string baseDirectory)
    {
        return Path.IsPathFullyQualified(path)
            ? Path.GetFullPath(path)
            : Path.GetFullPath(Path.Combine(baseDirectory, path));
    }

    public static string ResolveDeliveryManifestPath(string outputPdfPath)
    {
        return Path.Combine(
            Path.GetDirectoryName(outputPdfPath) ?? string.Empty,
            $"{Path.GetFileNameWithoutExtension(outputPdfPath)}.delivery-manifest.json");
    }

}
