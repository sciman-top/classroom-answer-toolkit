using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.App.Services;

public sealed record WorkspaceDiagnosticsExportRequest(
    string RepositoryRoot,
    WorkspaceHealthReport HealthReport,
    string? LastOutputPdfPath,
    string? LastDeliveryManifestPath,
    string? LastReviewDirectoryPath,
    string? LastSnapshotId);

public sealed record WorkspaceDiagnosticsExportResult(
    string BundleDirectoryPath,
    string ManifestPath,
    int FileCount);

public interface IWorkspaceDiagnosticsExporter
{
    WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request);
}
