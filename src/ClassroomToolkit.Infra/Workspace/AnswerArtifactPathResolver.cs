namespace ClassroomToolkit.Infra.Workspace;

public static class AnswerArtifactPathResolver
{
    public static string ResolveOutputPdfPath(string answerMarkdownPath, string? explicitOutputPdfPath)
    {
        if (!string.IsNullOrWhiteSpace(explicitOutputPdfPath))
        {
            return Path.GetFullPath(explicitOutputPdfPath);
        }

        return Path.ChangeExtension(Path.GetFullPath(answerMarkdownPath), ".pdf");
    }

    public static string ResolveDeliveryManifestPath(string outputPdfPath)
    {
        return Path.Combine(
            Path.GetDirectoryName(outputPdfPath) ?? string.Empty,
            $"{Path.GetFileNameWithoutExtension(outputPdfPath)}.delivery-manifest.json");
    }

    public static string ResolveReviewDirectoryPath(string repositoryRoot, string outputPdfPath)
    {
        var relativePdfPath = Path.GetRelativePath(repositoryRoot, outputPdfPath);
        var safeName = Path.GetFileNameWithoutExtension(outputPdfPath);
        var parentFragment = Path.GetDirectoryName(relativePdfPath)?
            .Replace(Path.DirectorySeparatorChar, '_')
            .Replace(Path.AltDirectorySeparatorChar, '_')
            .Trim('_');

        var folderName = string.IsNullOrWhiteSpace(parentFragment)
            ? safeName
            : $"{parentFragment}__{safeName}";

        return Path.Combine(repositoryRoot, ".pdf-review", folderName);
    }
}
