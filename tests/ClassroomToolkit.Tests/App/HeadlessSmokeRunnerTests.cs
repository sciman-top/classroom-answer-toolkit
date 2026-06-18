using ClassroomToolkit.App.Services;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class HeadlessSmokeRunnerTests
{
    [Fact]
    public void Run_ReturnsWorkspaceAndDiagnosticsSummary()
    {
        var runner = new HeadlessSmokeRunner(new FakeToolchainOrchestrator(), new FakeDiagnosticsExporter());

        var result = runner.Run();

        result.RepositoryRoot.Should().Be(@"D:\repo");
        result.WorkspaceHealthy.Should().BeTrue();
        result.DiagnosticsBundlePath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001");
        result.DiagnosticsManifestPath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json");
        result.DiagnosticsFileCount.Should().Be(3);
    }

    [Fact]
    public void Run_UsesWorkspaceDiagnosticsExporter()
    {
        var exporter = new FakeDiagnosticsExporter();
        var runner = new HeadlessSmokeRunner(new FakeToolchainOrchestrator(), exporter);

        runner.Run();

        exporter.LastRequest.Should().NotBeNull();
        exporter.LastRequest!.RepositoryRoot.Should().Be(@"D:\repo");
        exporter.LastRequest.HealthReport.IsHealthy.Should().BeTrue();
    }

    private sealed class FakeToolchainOrchestrator : IToolchainOrchestrator
    {
        public ToolchainWorkspaceInfo GetWorkspaceInfo()
        {
            return new ToolchainWorkspaceInfo(
                @"D:\repo",
                @"D:\repo\scripts\bootstrap.ps1",
                @"D:\repo\scripts\check-toolchain.ps1",
                BootstrapScriptExists: true,
                CheckScriptExists: true);
        }

        public WorkspaceHealthReport GetWorkspaceHealthReport()
        {
            return new WorkspaceHealthReport(
                "v11.2",
                "v11.2",
                SnapshotExists: true,
                SnapshotVersion: "v11.2",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 6,
                GraphicsExists: true,
                GraphicsSummary: "graphics ready",
                Summary: "workspace healthy",
                Issues: Array.Empty<string>());
        }

        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(ToolchainExecutionResult.Success(ToolchainScriptKind.Bootstrap, @"D:\repo\scripts\bootstrap.ps1", DateTimeOffset.Now, DateTimeOffset.Now, string.Empty));
        }

        public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(ToolchainExecutionResult.Success(ToolchainScriptKind.Check, @"D:\repo\scripts\check-toolchain.ps1", DateTimeOffset.Now, DateTimeOffset.Now, string.Empty));
        }

        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(AnswerDeliveryRequest request, CancellationToken cancellationToken = default)
        {
            throw new NotSupportedException();
        }
    }

    private sealed class FakeDiagnosticsExporter : IWorkspaceDiagnosticsExporter
    {
        public WorkspaceDiagnosticsExportRequest? LastRequest { get; private set; }

        public WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request)
        {
            LastRequest = request;
            return new WorkspaceDiagnosticsExportResult(
                @"D:\repo\artifacts\diagnostics\bundle-001",
                @"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json",
                3);
        }
    }
}
