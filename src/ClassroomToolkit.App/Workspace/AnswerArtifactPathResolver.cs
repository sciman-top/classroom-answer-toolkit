using System.IO;
namespace ClassroomToolkit.App.Workspace;

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
    //
    // Deliberately NOT containment-checked: the product contract is that source
    // PDFs, answer Markdown and delivery output may live in any user directory
    // (see README "运行脚本接受任意明确路径"). Absolute input therefore wins,
    // and a relative path resolves against baseDirectory even when it walks up.
    // This is a local desktop app acting on the operator's own files, so this is
    // a documented choice, not an escape vulnerability. Do not "harden" it into
    // a containment check without changing the documented contract first.
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
