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

}
