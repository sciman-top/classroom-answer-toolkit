using System.Text.Json;
using System.IO;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.App.Services;

public sealed record WorkspaceDiagnosticsAssetRecord(
    string Kind,
    string SourcePath,
    string TargetPath,
    bool Exists);

public sealed class WorkspaceDiagnosticsExporter : IWorkspaceDiagnosticsExporter
{
    public WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request)
    {
        var repositoryRoot = Path.GetFullPath(request.RepositoryRoot);
        var bundleRoot = Path.Combine(
            repositoryRoot,
            "artifacts",
            "diagnostics",
            $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}");

        Directory.CreateDirectory(bundleRoot);

        var assets = new List<WorkspaceDiagnosticsAssetRecord>();
        var workspaceRoot = Path.Combine(bundleRoot, "workspace");
        var deliveryRoot = Path.Combine(bundleRoot, "delivery");
        var primarySubjectPack = WorkspaceSubjectPackLocator.FindPrimarySubjectPack(repositoryRoot);
        var subjectPackManifestPath = primarySubjectPack?.ManifestPath ?? Path.Combine(repositoryRoot, "prompts", "physics-answer", "manifest.json");
        var subjectPackConfigPath = primarySubjectPack?.ConfigPath ?? Path.Combine(repositoryRoot, "prompts", "physics-answer", "config.json");
        var subjectPackEvalPath = primarySubjectPack?.EvalResultsPath ?? Path.Combine(repositoryRoot, "eval", "physics-answer", "results", "latest.json");
        var subjectPackSnapshotPath = primarySubjectPack?.SnapshotPath ?? Path.Combine(repositoryRoot, ".snapshot-cache", "resolved-snapshot.json");
        var subjectPackAssetId = primarySubjectPack?.AssetId ?? "physics-answer";

        CopyFileIfExists(
            subjectPackManifestPath,
            Path.Combine(workspaceRoot, "prompts", subjectPackAssetId, "manifest.json"),
            "manifest",
            assets);
        CopyFileIfExists(
            subjectPackConfigPath,
            Path.Combine(workspaceRoot, "prompts", subjectPackAssetId, "config.json"),
            "config",
            assets);
        CopyFileIfExists(
            subjectPackSnapshotPath,
            Path.Combine(workspaceRoot, "snapshot", Path.GetFileName(subjectPackSnapshotPath)),
            "snapshot",
            assets);
        CopyFileIfExists(
            subjectPackEvalPath,
            Path.Combine(workspaceRoot, "eval", "latest.json"),
            "eval",
            assets);
        CopyDirectoryIfExists(
            Path.Combine(repositoryRoot, ".answer-graphics"),
            Path.Combine(workspaceRoot, "answer-graphics"),
            "answer-graphics",
            assets);

        CopyFileIfExists(
            request.LastOutputPdfPath,
            Path.Combine(deliveryRoot, "answer.pdf"),
            "latest-pdf",
            assets);
        CopyFileIfExists(
            request.LastDeliveryManifestPath,
            Path.Combine(deliveryRoot, "delivery-manifest.json"),
            "latest-delivery-manifest",
            assets);
        CopyDirectoryIfExists(
            request.LastReviewDirectoryPath,
            Path.Combine(deliveryRoot, "review"),
            "latest-review",
            assets);

        var manifestPath = Path.Combine(bundleRoot, "diagnostic-manifest.json");
        assets.Add(new WorkspaceDiagnosticsAssetRecord(
            "diagnostic-manifest",
            manifestPath,
            manifestPath,
            true));

        var manifest = new
        {
            schemaVersion = "1.0",
            kind = "workspace-diagnostics-bundle",
            generatedAt = DateTimeOffset.Now.ToString("O"),
            bundleDirectoryPath = bundleRoot,
            repositoryRoot,
            lastOutputPdfPath = request.LastOutputPdfPath,
            lastDeliveryManifestPath = request.LastDeliveryManifestPath,
            lastReviewDirectoryPath = request.LastReviewDirectoryPath,
            lastSnapshotId = request.LastSnapshotId,
            health = request.HealthReport,
            assets
        };

        File.WriteAllText(
            manifestPath,
            JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }) + Environment.NewLine,
            System.Text.Encoding.UTF8);

        return new WorkspaceDiagnosticsExportResult(bundleRoot, manifestPath, assets.Count);
    }

    private static void CopyFileIfExists(
        string? sourcePath,
        string destinationPath,
        string kind,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
        {
            return;
        }

        var fullSourcePath = Path.GetFullPath(sourcePath);
        if (!File.Exists(fullSourcePath))
        {
            assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourcePath, destinationPath, false));
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        File.Copy(fullSourcePath, destinationPath, overwrite: true);
        assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourcePath, destinationPath, true));
    }

    private static void CopyDirectoryIfExists(
        string? sourceDirectory,
        string destinationDirectory,
        string kind,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(sourceDirectory))
        {
            return;
        }

        var fullSourceDirectory = Path.GetFullPath(sourceDirectory);
        if (!Directory.Exists(fullSourceDirectory))
        {
            assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourceDirectory, destinationDirectory, false));
            return;
        }

        CopyDirectory(fullSourceDirectory, destinationDirectory);
        assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourceDirectory, destinationDirectory, true));
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        Directory.CreateDirectory(destinationDirectory);

        foreach (var filePath in Directory.EnumerateFiles(sourceDirectory))
        {
            var destinationPath = Path.Combine(destinationDirectory, Path.GetFileName(filePath));
            File.Copy(filePath, destinationPath, overwrite: true);
        }

        foreach (var subDirectory in Directory.EnumerateDirectories(sourceDirectory))
        {
            var destinationPath = Path.Combine(destinationDirectory, Path.GetFileName(subDirectory));
            CopyDirectory(subDirectory, destinationPath);
        }
    }
}
