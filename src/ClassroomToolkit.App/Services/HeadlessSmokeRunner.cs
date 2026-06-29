using ClassroomToolkit.Application.Abstractions;
using System.IO;

namespace ClassroomToolkit.App.Services;

public sealed record HeadlessSmokeResult(
    string RepositoryRoot,
    string WorkspaceSummary,
    bool WorkspaceHealthy,
    string HealthSummary,
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks,
    string SnapshotPath,
    string? LastDeliverySubjectPack,
    string? LastDeliveryProfile,
    string? LastSnapshotId,
    string? LastDeliverySnapshotPath,
    string? LastDeliverySnapshotVersion,
    string? LastDeliveryInputPath,
    string? LastDeliveryOutputPath,
    string? LastDeliveryReviewDirectoryPath,
    string DiagnosticsBundlePath,
    string DiagnosticsManifestPath,
    int DiagnosticsFileCount);

public interface IHeadlessSmokeRunner
{
    HeadlessSmokeResult Run();
}

public sealed class HeadlessSmokeRunner : IHeadlessSmokeRunner
{
    private readonly IToolchainOrchestrator _toolchainOrchestrator;
    private readonly IWorkspaceDiagnosticsExporter _workspaceDiagnosticsExporter;

    public HeadlessSmokeRunner(
        IToolchainOrchestrator toolchainOrchestrator,
        IWorkspaceDiagnosticsExporter workspaceDiagnosticsExporter)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _workspaceDiagnosticsExporter = workspaceDiagnosticsExporter;
    }

    public HeadlessSmokeResult Run()
    {
        var workspaceInfo = _toolchainOrchestrator.GetWorkspaceInfo();
        var healthReport = _toolchainOrchestrator.GetWorkspaceHealthReport();
        var diagnostics = _workspaceDiagnosticsExporter.Export(new WorkspaceDiagnosticsExportRequest(
            workspaceInfo.RepositoryRoot,
            healthReport,
            null,
            null,
            null,
            null));
        var lastDeliveryContext = ReadLastDeliveryContext(diagnostics.ManifestPath);

        return new HeadlessSmokeResult(
            workspaceInfo.RepositoryRoot,
            workspaceInfo.Summary,
            healthReport.IsHealthy,
            healthReport.Summary,
            healthReport.PrimarySubjectPack,
            healthReport.SubjectPacks,
            healthReport.SnapshotPath,
            lastDeliveryContext.SubjectPack,
            lastDeliveryContext.Profile,
            lastDeliveryContext.SnapshotId,
            lastDeliveryContext.SnapshotPath,
            lastDeliveryContext.SnapshotVersion,
            lastDeliveryContext.InputPath,
            lastDeliveryContext.OutputPath,
            lastDeliveryContext.ReviewDirectoryPath,
            diagnostics.BundleDirectoryPath,
            diagnostics.ManifestPath,
            diagnostics.FileCount);
    }

    private static (
        string? SubjectPack,
        string? Profile,
        string? SnapshotId,
        string? SnapshotPath,
        string? SnapshotVersion,
        string? InputPath,
        string? OutputPath,
        string? ReviewDirectoryPath) ReadLastDeliveryContext(string manifestPath)
    {
        if (!File.Exists(manifestPath))
        {
            return (null, null, null, null, null, null, null, null);
        }

        using var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifestPath));
        if (!document.RootElement.TryGetProperty("lastDeliveryContext", out var deliveryContextElement))
        {
            return (null, null, null, null, null, null, null, null);
        }

        if (deliveryContextElement.ValueKind is System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined)
        {
            return (null, null, null, null, null, null, null, null);
        }

        return (
            deliveryContextElement.TryGetProperty("subjectPack", out var subjectPackElement) ? subjectPackElement.GetString() : null,
            deliveryContextElement.TryGetProperty("profile", out var profileElement) ? profileElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotId", out var snapshotIdElement) ? snapshotIdElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotPath", out var snapshotPathElement) ? snapshotPathElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotVersion", out var snapshotVersionElement) ? snapshotVersionElement.GetString() : null,
            deliveryContextElement.TryGetProperty("input", out var inputElement) ? inputElement.GetString() : null,
            deliveryContextElement.TryGetProperty("output", out var outputElement) ? outputElement.GetString() : null,
            deliveryContextElement.TryGetProperty("reviewDirectoryPath", out var reviewDirectoryPathElement) ? reviewDirectoryPathElement.GetString() : null);
    }
}
