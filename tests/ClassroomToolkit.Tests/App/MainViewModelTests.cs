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
            SelectedAnswerMarkdownPath = @"D:\repo\样例交付\sample-answer.md",
            SelectedOutputPdfPath = @"D:\repo\样例交付\sample-answer.pdf",
            SelectedSubjectPack = "math-answer",
            SelectedProfile = "classroom",
            KeepReviewArtifacts = true
        };

        await viewModel.DeliverCommand.ExecuteAsync(null);

        viewModel.LastOutputPdfPath.Should().Be(@"D:\repo\样例交付\sample-answer.pdf");
        viewModel.LastDeliveryManifestPath.Should().Be(@"D:\repo\样例交付\sample-answer.delivery-manifest.json");
        viewModel.LastReviewDirectoryPath.Should().Be(@"D:\repo\.pdf-review\sample-answer");
        viewModel.LastSnapshotId.Should().Be("snapshot-test");
        viewModel.LastDeliverySubjectPack.Should().Be("math-answer");
        viewModel.LastDeliveryProfile.Should().Be("classroom");
        viewModel.LastDeliverySnapshotPath.Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.math.json");
        viewModel.LastDeliverySnapshotVersion.Should().Be("v0.1");
        viewModel.LastReviewLifecycleState.Should().Be("ready_for_review");
        viewModel.LastVisualReviewStatus.Should().Be("未裁定");
        viewModel.LastTrustStatus.Should().Be("未可信");
        viewModel.LastAggregateVerificationStatus.Should().Be("未验证");
        viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
        viewModel.LastVisualDecisionPath.Should().Be(@"D:\repo\review\decision-001.json");
        viewModel.StatusMessage.Should().Be("答案交付完成");
        orchestrator.LastRequest.Should().NotBeNull();
        orchestrator.LastRequest!.SubjectPack.Should().Be("math-answer");

        viewModel.OpenLastOutputPdfCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(@"D:\repo\样例交付\sample-answer.pdf");

        viewModel.OpenLastVisualDecisionCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(@"D:\repo\review\decision-001.json");

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
        viewModel.AvailableSubjectPacks.Should().ContainInOrder("math-answer", "junior-physics-answer");
    }

    [Fact]
    public async Task AttachVisualDecisionAsync_RefreshesReviewAndTrustProjection()
    {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"delivery-{Guid.NewGuid():N}.json");
        var decisionPath = Path.Combine(Path.GetTempPath(), $"decision-{Guid.NewGuid():N}.json");
        File.WriteAllText(manifestPath, "{}");
        File.WriteAllText(decisionPath, "{}");
        try
        {
            var orchestrator = new FakeToolchainOrchestrator();
            var viewModel = new MainViewModel(
                orchestrator,
                new FakePathOpener(),
                new FakeDiagnosticsExporter())
            {
                LastDeliveryManifestPath = manifestPath
            };

            await viewModel.AttachVisualDecisionCommand.ExecuteAsync(decisionPath);

            orchestrator.LastAttachmentRequest.Should().Be(
                new VisualDecisionAttachmentRequest(manifestPath, decisionPath));
            viewModel.LastVisualDecisionPath.Should().Be(decisionPath);
            viewModel.LastVisualReviewStatus.Should().Be("未通过");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("未验证");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
            viewModel.StatusMessage.Should().Be("视觉决策已关联");
        }
        finally
        {
            File.Delete(manifestPath);
            File.Delete(decisionPath);
        }
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_AppliesHashBoundPositiveProjection()
    {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"delivery-{Guid.NewGuid():N}.json");
        File.WriteAllText(manifestPath, "{}");
        try
        {
            var orchestrator = new FakeToolchainOrchestrator();
            var viewModel = new MainViewModel(
                orchestrator,
                new FakePathOpener(),
                new FakeDiagnosticsExporter())
            {
                LastDeliveryManifestPath = manifestPath
            };

            await viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.ExecuteAsync(null);

            orchestrator.LastVerificationRequest.Should().Be(
                new DeliveryDecisionAggregateAttachmentVerificationRequest(manifestPath));
            viewModel.LastVisualReviewStatus.Should().Be("通过");
            viewModel.LastTrustStatus.Should().Be("可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("已验证");
            viewModel.LastAggregateManifestResultSha256.Should().Be(new string('d', 64));
            viewModel.StatusMessage.Should().Be("交付聚合凭据已验证");
        }
        finally
        {
            File.Delete(manifestPath);
        }
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_ClampsStaleTrust_WhenVerificationFails()
    {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"delivery-{Guid.NewGuid():N}.json");
        File.WriteAllText(manifestPath, "{}");
        try
        {
            var orchestrator = new FakeToolchainOrchestrator
            {
                FailAggregateVerification = true
            };
            var viewModel = new MainViewModel(
                orchestrator,
                new FakePathOpener(),
                new FakeDiagnosticsExporter())
            {
                LastDeliveryManifestPath = manifestPath,
                LastVisualReviewStatus = "通过",
                LastTrustStatus = "可信",
                LastAggregateVerificationStatus = "已验证",
                LastAggregateManifestResultSha256 = new string('d', 64)
            };

            await viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.ExecuteAsync(null);

            viewModel.LastVisualReviewStatus.Should().Be("未裁定");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("验证失败");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
            viewModel.StatusMessage.Should().Be("交付聚合凭据验证失败");
        }
        finally
        {
            File.Delete(manifestPath);
        }
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_ClampsStaleTrust_WhenVerificationThrows()
    {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"delivery-{Guid.NewGuid():N}.json");
        File.WriteAllText(manifestPath, "{}");
        try
        {
            var orchestrator = new FakeToolchainOrchestrator
            {
                ThrowAggregateVerification = true
            };
            var viewModel = new MainViewModel(
                orchestrator,
                new FakePathOpener(),
                new FakeDiagnosticsExporter())
            {
                LastDeliveryManifestPath = manifestPath,
                LastVisualReviewStatus = "通过",
                LastTrustStatus = "可信",
                LastAggregateVerificationStatus = "已验证",
                LastAggregateManifestResultSha256 = new string('d', 64)
            };

            await viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.ExecuteAsync(null);

            viewModel.LastVisualReviewStatus.Should().Be("未裁定");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("验证异常");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
            viewModel.StatusMessage.Should().Be("交付聚合凭据验证异常");
        }
        finally
        {
            File.Delete(manifestPath);
        }
    }

    [Fact]
    public void VerifyDeliveryDecisionAggregateAttachmentCommand_TracksManifestAndBusyState()
    {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"delivery-{Guid.NewGuid():N}.json");
        var viewModel = new MainViewModel(
            new FakeToolchainOrchestrator(),
            new FakePathOpener(),
            new FakeDiagnosticsExporter());

        viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeFalse();
        File.WriteAllText(manifestPath, "{}");
        try
        {
            viewModel.LastDeliveryManifestPath = manifestPath;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeTrue();

            viewModel.IsBusy = true;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeFalse();

            viewModel.IsBusy = false;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeTrue();

            File.Delete(manifestPath);
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeFalse();
        }
        finally
        {
            if (File.Exists(manifestPath))
            {
                File.Delete(manifestPath);
            }
        }
    }

    private sealed class FakeToolchainOrchestrator : IToolchainOrchestrator
    {
        public AnswerDeliveryRequest? LastRequest { get; private set; }

        public VisualDecisionAttachmentRequest? LastAttachmentRequest { get; private set; }

        public DeliveryDecisionAggregateAttachmentVerificationRequest? LastVerificationRequest { get; private set; }

        public bool FailAggregateVerification { get; init; }

        public bool ThrowAggregateVerification { get; init; }

        public ToolchainWorkspaceInfo GetWorkspaceInfo()
        {
            return new ToolchainWorkspaceInfo(
                @"D:\repo",
                @"D:\repo\scripts\bootstrap.ps1",
                @"D:\repo\scripts\check-toolchain.ps1",
                BootstrapScriptExists: true,
                CheckScriptExists: true,
                PrimarySubjectPack: "math-answer",
                SubjectPacks: ["math-answer", "junior-physics-answer"]);
        }

        public WorkspaceHealthReport GetWorkspaceHealthReport()
        {
            return new WorkspaceHealthReport(
                "math-answer",
                ["math-answer", "junior-physics-answer"],
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
                request.OutputPdfPath ?? @"D:\repo\样例交付\sample-answer.pdf",
                @"D:\repo\样例交付\sample-answer.delivery-manifest.json",
                @"D:\repo\.pdf-review\sample-answer",
                "snapshot-test",
                request.SubjectPack ?? "math-answer",
                request.Profile,
                @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                "v0.1")
            {
                ReviewLifecycleState = "ready_for_review",
                VisualDecisionPath = @"D:\repo\review\decision-001.json",
                VisualReviewPassed = null,
                Trusted = false
            };

            return Task.FromResult<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)>((execution, delivery));
        }

        public Task<VisualDecisionAttachmentResult> AttachVisualDecisionAsync(
            VisualDecisionAttachmentRequest request,
            CancellationToken cancellationToken = default)
        {
            LastAttachmentRequest = request;
            var execution = Success(
                ToolchainScriptKind.AttachVisualDecision,
                @"D:\repo\tools\visual-evidence\attach-decision.mjs");
            var delivery = new AnswerDeliveryResult(
                @"D:\repo\样例交付\sample-answer.md",
                @"D:\repo\样例交付\sample-answer.pdf",
                request.DeliveryManifestPath,
                @"D:\repo\.pdf-review\sample-answer",
                "snapshot-test",
                "math-answer",
                "classroom",
                @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                "v0.1")
            {
                ReviewLifecycleState = "ready_for_review",
                VisualDecisionPath = request.DecisionRecordPath,
                VisualReviewPassed = false,
                Trusted = false
            };
            return Task.FromResult(new VisualDecisionAttachmentResult(execution, delivery));
        }

        public Task<DeliveryDecisionAggregateAttachmentVerificationResult> VerifyDeliveryDecisionAggregateAttachmentAsync(
            DeliveryDecisionAggregateAttachmentVerificationRequest request,
            CancellationToken cancellationToken = default)
        {
            LastVerificationRequest = request;
            if (ThrowAggregateVerification)
            {
                throw new InvalidOperationException("synthetic verification exception");
            }

            var execution = FailAggregateVerification
                ? ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                    @"D:\repo\tools\visual-evidence\verify-delivery-decision-aggregate-attachment.mjs",
                    1,
                    DateTimeOffset.Now,
                    DateTimeOffset.Now,
                    "synthetic verification failure")
                : Success(
                    ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                    @"D:\repo\tools\visual-evidence\verify-delivery-decision-aggregate-attachment.mjs");
            if (FailAggregateVerification)
            {
                return Task.FromResult(
                    new DeliveryDecisionAggregateAttachmentVerificationResult(execution, null));
            }

            var verification = new DeliveryDecisionAggregateAttachmentVerification(
                request.DeliveryManifestPath,
                @"D:\repo\aggregate.json",
                @"D:\repo\manifest.before.json",
                @"D:\repo\receipt.json",
                "aggregate-attachment-test",
                new string('a', 64),
                new string('d', 64),
                VisualReviewPassed: true,
                Trusted: true);
            var delivery = new AnswerDeliveryResult(
                @"D:\repo\样例交付\sample-answer.md",
                @"D:\repo\样例交付\sample-answer.pdf",
                request.DeliveryManifestPath,
                @"D:\repo\.pdf-review\sample-answer",
                "snapshot-test",
                "math-answer",
                "classroom",
                @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                "v0.1")
            {
                ReviewLifecycleState = "approved",
                VisualReviewPassed = true,
                Trusted = true
            };
            return Task.FromResult(
                new DeliveryDecisionAggregateAttachmentVerificationResult(
                    execution,
                    verification,
                    delivery));
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
