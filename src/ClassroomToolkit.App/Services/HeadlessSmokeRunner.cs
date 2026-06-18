using ClassroomToolkit.Application.Abstractions;

namespace ClassroomToolkit.App.Services;

public sealed record HeadlessSmokeResult(
    string RepositoryRoot,
    string WorkspaceSummary,
    bool WorkspaceHealthy,
    string HealthSummary,
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

        return new HeadlessSmokeResult(
            workspaceInfo.RepositoryRoot,
            workspaceInfo.Summary,
            healthReport.IsHealthy,
            healthReport.Summary,
            diagnostics.BundleDirectoryPath,
            diagnostics.ManifestPath,
            diagnostics.FileCount);
    }
}
