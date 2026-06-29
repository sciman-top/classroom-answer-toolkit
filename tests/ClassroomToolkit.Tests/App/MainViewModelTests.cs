using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainViewModelTests
{
    [Fact]
    public async Task DeliverAsync_UpdatesRecentArtifactState_AndSnapshotId()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var pathOpener = new FakePathOpener();
        var diagnosticsExporter = new FakeDiagnosticsExporter();
        var viewModel = new MainViewModel(orchestrator, pathOpener, diagnosticsExporter)
        {
            SelectedAnswerMarkdownPath = @"D:\repo\习题PDF\sample-answer.md",
            SelectedOutputPdfPath = @"D:\repo\习题PDF\sample-answer.pdf",
            SelectedSubjectPack = "math-answer",
            SelectedProfile = "classroom",
            KeepReviewArtifacts = true
        };

        await viewModel.DeliverCommand.ExecuteAsync(null);

        viewModel.LastOutputPdfPath.Should().Be(@"D:\repo\习题PDF\sample-answer.pdf");
        viewModel.LastDeliveryManifestPath.Should().Be(@"D:\repo\习题PDF\sample-answer.delivery-manifest.json");
        viewModel.LastReviewDirectoryPath.Should().Be(@"D:\repo\.pdf-review\sample-answer");
        viewModel.LastSnapshotId.Should().Be("snapshot-test");
        viewModel.LastDeliverySubjectPack.Should().Be("math-answer");
        viewModel.LastDeliveryProfile.Should().Be("classroom");
        viewModel.LastDeliverySnapshotPath.Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.math.json");
        viewModel.LastDeliverySnapshotVersion.Should().Be("v0.1");
        viewModel.StatusMessage.Should().Be("答案交付完成");
        orchestrator.LastRequest.Should().NotBeNull();
        orchestrator.LastRequest!.SubjectPack.Should().Be("math-answer");

        viewModel.OpenLastOutputPdfCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(@"D:\repo\习题PDF\sample-answer.pdf");

        viewModel.ExportDiagnosticsCommand.Execute(null);
        viewModel.LastDiagnosticsBundlePath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001");
        viewModel.LastDiagnosticsManifestPath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json");
        viewModel.LastResultSummary.Should().Contain("诊断包已导出");

        viewModel.OpenLastDiagnosticsBundleCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001");

        viewModel.OpenLastDiagnosticsManifestCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json");
    }

    [Fact]
    public void Constructor_UsesPrimarySubjectPack_AsDefaultSelection()
    {
        var viewModel = new MainViewModel(new FakeToolchainOrchestrator(), new FakePathOpener(), new FakeDiagnosticsExporter());

        viewModel.SelectedSubjectPack.Should().Be("math-answer");
        viewModel.AvailableSubjectPacks.Should().ContainInOrder("math-answer", "physics-answer");
    }

    private sealed class FakeToolchainOrchestrator : IToolchainOrchestrator
    {
        public AnswerDeliveryRequest? LastRequest { get; private set; }

        public ToolchainWorkspaceInfo GetWorkspaceInfo()
        {
            return new ToolchainWorkspaceInfo(
                @"D:\repo",
                @"D:\repo\scripts\bootstrap.ps1",
                @"D:\repo\scripts\check-toolchain.ps1",
                BootstrapScriptExists: true,
                CheckScriptExists: true,
                PrimarySubjectPack: "math-answer",
                SubjectPacks: ["math-answer", "physics-answer"]);
        }

        public WorkspaceHealthReport GetWorkspaceHealthReport()
        {
            return new WorkspaceHealthReport(
                "math-answer",
                ["math-answer", "physics-answer"],
                "v11.1",
                "v11.1",
                SnapshotExists: true,
                SnapshotPath: @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                SnapshotVersion: "v11.1",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 5,
                GraphicsExists: true,
                GraphicsSummary: "图块产物已生成，包含 placement 记录。",
                Summary: "规则快照、评测结果与最新规范已对齐。",
                Issues: Array.Empty<string>());
        }

        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Success(ToolchainScriptKind.Bootstrap, @"D:\repo\scripts\bootstrap.ps1"));
        }

        public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Success(ToolchainScriptKind.Check, @"D:\repo\scripts\check-toolchain.ps1"));
        }

        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
            AnswerDeliveryRequest request,
            CancellationToken cancellationToken = default)
        {
            LastRequest = request;

            var execution = Success(ToolchainScriptKind.Deliver, @"D:\repo\tools\latex-renderer\deliver-answer.mjs");
            var delivery = new AnswerDeliveryResult(
                request.AnswerMarkdownPath,
                request.OutputPdfPath ?? @"D:\repo\习题PDF\sample-answer.pdf",
                @"D:\repo\习题PDF\sample-answer.delivery-manifest.json",
                @"D:\repo\.pdf-review\sample-answer",
                "snapshot-test",
                request.SubjectPack ?? "math-answer",
                request.Profile,
                @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                "v0.1");

            return Task.FromResult<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)>((execution, delivery));
        }

        private static ToolchainExecutionResult Success(ToolchainScriptKind kind, string scriptPath)
        {
            var startedAt = new DateTimeOffset(2026, 6, 18, 10, 0, 0, TimeSpan.Zero);
            return ToolchainExecutionResult.Success(kind, scriptPath, startedAt, startedAt.AddSeconds(1), string.Empty);
        }
    }

    private sealed class FakePathOpener : IPathOpener
    {
        public string? LastOpenedPath { get; private set; }

        public bool TryOpenPath(string path, out string? errorMessage)
        {
            LastOpenedPath = path;
            errorMessage = null;
            return true;
        }
    }

    private sealed class FakeDiagnosticsExporter : IWorkspaceDiagnosticsExporter
    {
        public WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request)
        {
            return new WorkspaceDiagnosticsExportResult(
                @"D:\repo\artifacts\diagnostics\bundle-001",
                @"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json",
                7);
        }
    }
}
