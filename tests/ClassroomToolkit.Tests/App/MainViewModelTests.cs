using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Generation;
using ClassroomToolkit.Domain.Review;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainViewModelTests
{
    [Fact]
    public async Task GenerateProviderAnswerAsync_RequiresExplicitConsent_WithoutDispatch()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var viewModel = new MainViewModel(orchestrator, new FakePathOpener(), new FakeDiagnosticsExporter())
        {
            GenerationRequestArtifactPath = @"D:\bundle\request.json",
            GenerationWorkspaceRoot = @"D:\bundle",
            GenerationOutputDirectoryPath = @"E:\outputs\candidate-001",
            AllowGenerationCloudEgress = false
        };

        await viewModel.GenerateProviderAnswerCommand.ExecuteAsync(null);

        orchestrator.LastGenerationRequest.Should().BeNull();
        viewModel.SelectedAnswerMarkdownPath.Should().BeEmpty();
    }

    [Fact]
    public async Task GenerateProviderAnswerAsync_PopulatesDeliveryInput_WithoutStartingDelivery()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var viewModel = new MainViewModel(orchestrator, new FakePathOpener(), new FakeDiagnosticsExporter())
        {
            GenerationRequestArtifactPath = @"D:\bundle\题目 request.json",
            GenerationWorkspaceRoot = @"D:\bundle",
            GenerationOutputDirectoryPath = @"E:\课堂输出\candidate-001",
            GenerationConfigEnvFilePath = @"D:\repo\.env",
            AllowGenerationCloudEgress = true
        };

        await viewModel.GenerateProviderAnswerCommand.ExecuteAsync(null);

        orchestrator.LastGenerationRequest.Should().Be(new ProviderAnswerGenerationExecutionRequest(
            @"D:\bundle\题目 request.json",
            @"D:\bundle",
            @"E:\课堂输出\candidate-001",
            @"D:\repo\.env",
            AllowCloudEgress: true));
        orchestrator.LastRequest.Should().BeNull("generation and delivery remain separate explicit actions");
        viewModel.SelectedAnswerMarkdownPath.Should().Be(@"E:\课堂输出\candidate-001\answer.md");
        viewModel.SelectedOutputPdfPath.Should().Be(@"E:\课堂输出\candidate-001\answer.pdf");
        viewModel.LastGeneratedResultPath.Should().Be(@"E:\课堂输出\candidate-001\answer-generation-result.json");
        viewModel.LastGenerationReviewStatus.Should().Be("待人工复核");
        viewModel.LastGenerationTrustStatus.Should().Be("未可信");
        viewModel.StatusMessage.Should().Be("Provider 答案已生成，等待显式交付");
    }

    [Fact]
    public async Task GenerateProviderAnswerAsync_FailureClearsPriorGeneratedCandidate()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var viewModel = new MainViewModel(orchestrator, new FakePathOpener(), new FakeDiagnosticsExporter())
        {
            GenerationRequestArtifactPath = @"D:\bundle\request.json",
            GenerationWorkspaceRoot = @"D:\bundle",
            GenerationOutputDirectoryPath = @"E:\outputs\candidate-001",
            AllowGenerationCloudEgress = true
        };
        await viewModel.GenerateProviderAnswerCommand.ExecuteAsync(null);
        orchestrator.FailGeneration = true;
        viewModel.GenerationOutputDirectoryPath = @"E:\outputs\candidate-002";

        await viewModel.GenerateProviderAnswerCommand.ExecuteAsync(null);

        viewModel.SelectedAnswerMarkdownPath.Should().BeEmpty();
        viewModel.LastGeneratedAnswerMarkdownPath.Should().BeEmpty();
        viewModel.LastGeneratedResultPath.Should().BeEmpty();
        viewModel.LastGenerationReviewStatus.Should().Be("未生成");
        viewModel.LastGenerationTrustStatus.Should().Be("未可信");
        viewModel.StatusMessage.Should().Be("Provider 答案生成失败");
    }

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
        viewModel.AttachDeliveryDecisionAggregateCommand.CanExecute(null).Should().BeFalse();
        File.WriteAllText(manifestPath, "{}");
        try
        {
            viewModel.LastDeliveryManifestPath = manifestPath;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeTrue();
            viewModel.AttachDeliveryDecisionAggregateCommand.CanExecute(null).Should().BeTrue();

            viewModel.IsBusy = true;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeFalse();
            viewModel.AttachDeliveryDecisionAggregateCommand.CanExecute(null).Should().BeFalse();

            viewModel.IsBusy = false;
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeTrue();
            viewModel.AttachDeliveryDecisionAggregateCommand.CanExecute(null).Should().BeTrue();

            File.Delete(manifestPath);
            viewModel.VerifyDeliveryDecisionAggregateAttachmentCommand.CanExecute(null).Should().BeFalse();
            viewModel.AttachDeliveryDecisionAggregateCommand.CanExecute(null).Should().BeFalse();
        }
        finally
        {
            if (File.Exists(manifestPath))
            {
                File.Delete(manifestPath);
            }
        }
    }

    [Fact]
    public async Task AttachDeliveryDecisionAggregateAsync_AttachesThenAppliesHashBoundProjection()
    {
        var manifestPath = Path.GetTempFileName();
        var aggregatePath = Path.GetTempFileName();
        try
        {
            var orchestrator = new FakeToolchainOrchestrator();
            var viewModel = new MainViewModel(
                orchestrator,
                new FakePathOpener(),
                new FakeDiagnosticsExporter());
            viewModel.LastDeliveryManifestPath = manifestPath;

            await viewModel.AttachDeliveryDecisionAggregateCommand.ExecuteAsync(aggregatePath);

            orchestrator.LastAggregateAttachmentRequest.Should().Be(
                new DeliveryDecisionAggregateAttachmentRequest(manifestPath, aggregatePath));
            viewModel.LastVisualReviewStatus.Should().Be("通过");
            viewModel.LastTrustStatus.Should().Be("可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("已验证");
            viewModel.LastAggregateManifestResultSha256.Should().Be(new string('d', 64));
            viewModel.StatusMessage.Should().Be("交付聚合凭据已关联并验证");
        }
        finally
        {
            File.Delete(manifestPath);
            File.Delete(aggregatePath);
        }
    }

    [Fact]
    public async Task AttachDeliveryDecisionAggregateAsync_ClampsStaleTrust_WhenAttachmentFails()
    {
        var manifestPath = Path.GetTempFileName();
        var aggregatePath = Path.GetTempFileName();
        try
        {
            var viewModel = new MainViewModel(
                new FakeToolchainOrchestrator
                {
                    FailAggregateAttachment = true
                },
                new FakePathOpener(),
                new FakeDiagnosticsExporter());
            viewModel.LastDeliveryManifestPath = manifestPath;
            viewModel.LastVisualReviewStatus = "通过";
            viewModel.LastTrustStatus = "可信";
            viewModel.LastAggregateVerificationStatus = "已验证";
            viewModel.LastAggregateManifestResultSha256 = new string('d', 64);

            await viewModel.AttachDeliveryDecisionAggregateCommand.ExecuteAsync(aggregatePath);

            viewModel.LastVisualReviewStatus.Should().Be("未裁定");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("附着失败");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
        }
        finally
        {
            File.Delete(manifestPath);
            File.Delete(aggregatePath);
        }
    }

    [Fact]
    public async Task AttachDeliveryDecisionAggregateAsync_ClampsStaleTrust_WhenReverificationFails()
    {
        var manifestPath = Path.GetTempFileName();
        var aggregatePath = Path.GetTempFileName();
        try
        {
            var viewModel = new MainViewModel(
                new FakeToolchainOrchestrator
                {
                    FailAggregateVerification = true
                },
                new FakePathOpener(),
                new FakeDiagnosticsExporter());
            viewModel.LastDeliveryManifestPath = manifestPath;
            viewModel.LastVisualReviewStatus = "通过";
            viewModel.LastTrustStatus = "可信";
            viewModel.LastAggregateVerificationStatus = "已验证";
            viewModel.LastAggregateManifestResultSha256 = new string('d', 64);

            await viewModel.AttachDeliveryDecisionAggregateCommand.ExecuteAsync(aggregatePath);

            viewModel.LastVisualReviewStatus.Should().Be("未裁定");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("验证失败");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
        }
        finally
        {
            File.Delete(manifestPath);
            File.Delete(aggregatePath);
        }
    }

    [Fact]
    public async Task AttachDeliveryDecisionAggregateAsync_ClampsStaleTrust_WhenAttachmentThrows()
    {
        var manifestPath = Path.GetTempFileName();
        var aggregatePath = Path.GetTempFileName();
        try
        {
            var viewModel = new MainViewModel(
                new FakeToolchainOrchestrator
                {
                    ThrowAggregateAttachment = true
                },
                new FakePathOpener(),
                new FakeDiagnosticsExporter());
            viewModel.LastDeliveryManifestPath = manifestPath;
            viewModel.LastVisualReviewStatus = "通过";
            viewModel.LastTrustStatus = "可信";
            viewModel.LastAggregateVerificationStatus = "已验证";
            viewModel.LastAggregateManifestResultSha256 = new string('d', 64);

            await viewModel.AttachDeliveryDecisionAggregateCommand.ExecuteAsync(aggregatePath);

            viewModel.LastVisualReviewStatus.Should().Be("未裁定");
            viewModel.LastTrustStatus.Should().Be("未可信");
            viewModel.LastAggregateVerificationStatus.Should().Be("附着异常");
            viewModel.LastAggregateManifestResultSha256.Should().BeEmpty();
        }
        finally
        {
            File.Delete(manifestPath);
            File.Delete(aggregatePath);
        }
    }

    [Fact]
    public async Task ProjectReviewQueueAsync_ProjectsCounts_AndOpensSelectedSource()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var pathOpener = new FakePathOpener();
        var viewModel = new MainViewModel(
            orchestrator,
            pathOpener,
            new FakeDiagnosticsExporter());
        var paths = new[] { @"D:\repo\feedback.json", @"D:\repo\decision.json" };

        await viewModel.ProjectReviewQueueCommand.ExecuteAsync(paths);

        orchestrator.LastReviewQueueRequest.Should().BeEquivalentTo(
            new ReviewQueueProjectionRequest(paths));
        viewModel.ReviewQueueProjectionStatus.Should().Be("本地已验证投影");
        viewModel.NeedsHumanLabelCount.Should().Be(1);
        viewModel.HighRiskApprovalCount.Should().Be(1);
        viewModel.TruthNeedsReviewCount.Should().Be(0);
        viewModel.ReviewQueueItems.Should().HaveCount(2);

        viewModel.SelectedReviewQueueItem = viewModel.ReviewQueueItems[0];
        viewModel.OpenSelectedReviewQueueSourceCommand.Execute(null);
        pathOpener.LastOpenedPath.Should().Be(viewModel.ReviewQueueItems[0].SourcePath);
    }

    [Fact]
    public async Task ProjectReviewQueueAsync_ClearsStaleItems_WhenSourceIsRejected()
    {
        var orchestrator = new FakeToolchainOrchestrator();
        var viewModel = new MainViewModel(
            orchestrator,
            new FakePathOpener(),
            new FakeDiagnosticsExporter());
        await viewModel.ProjectReviewQueueCommand.ExecuteAsync(
            new[] { @"D:\repo\feedback.json", @"D:\repo\decision.json" });
        orchestrator.RejectReviewQueueProjection = true;

        await viewModel.ProjectReviewQueueCommand.ExecuteAsync(new[] { @"D:\repo\bad.json" });

        viewModel.ReviewQueueProjectionStatus.Should().Be("来源被拒绝");
        viewModel.ReviewQueueItems.Should().BeEmpty();
        viewModel.NeedsHumanLabelCount.Should().Be(0);
        viewModel.HighRiskApprovalCount.Should().Be(0);
        viewModel.TruthNeedsReviewCount.Should().Be(0);
    }

    private sealed class FakeToolchainOrchestrator : IToolchainOrchestrator
    {
        public AnswerDeliveryRequest? LastRequest { get; private set; }

        public ProviderAnswerGenerationExecutionRequest? LastGenerationRequest { get; private set; }

        public VisualDecisionAttachmentRequest? LastAttachmentRequest { get; private set; }

        public DeliveryDecisionAggregateAttachmentVerificationRequest? LastVerificationRequest { get; private set; }

        public DeliveryDecisionAggregateAttachmentRequest? LastAggregateAttachmentRequest { get; private set; }

        public ReviewQueueProjectionRequest? LastReviewQueueRequest { get; private set; }

        public bool RejectReviewQueueProjection { get; set; }

        public bool FailGeneration { get; set; }

        public bool FailAggregateAttachment { get; init; }

        public bool ThrowAggregateAttachment { get; init; }

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

        public Task<ProviderAnswerGenerationExecutionResult> RunProviderAnswerGenerationAsync(
            ProviderAnswerGenerationExecutionRequest request,
            CancellationToken cancellationToken = default)
        {
            LastGenerationRequest = request;
            var script = @"D:\repo\tools\answer-generator\provider-generator.mjs";
            if (FailGeneration)
            {
                var failed = ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.GenerateProviderAnswer,
                    script,
                    1,
                    DateTimeOffset.Now,
                    DateTimeOffset.Now,
                    "synthetic provider failure");
                return Task.FromResult(new ProviderAnswerGenerationExecutionResult(failed, null, null, null));
            }

            var answerPath = Path.Combine(request.OutputDirectoryPath, "answer.md");
            var resultPath = Path.Combine(request.OutputDirectoryPath, "answer-generation-result.json");
            var generation = new AnswerGenerationResult(
                "provider-request-001",
                "math-answer",
                new string('a', 64),
                "# answer\n",
                "answer.md",
                new string('b', 64),
                new AnswerGenerationDataClassification("public", "Public problem."),
                new AnswerGenerationProvenance("model_provider", "primary", "test-model", true, "responses", 1, true),
                "provider_generated_pending_review",
                new AnswerGenerationDisposition(true, false, "pending_review", "not_integrated"));
            return Task.FromResult(new ProviderAnswerGenerationExecutionResult(
                Success(ToolchainScriptKind.GenerateProviderAnswer, script),
                generation,
                answerPath,
                resultPath));
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

        public async Task<DeliveryDecisionAggregateAttachmentResult> AttachDeliveryDecisionAggregateAsync(
            DeliveryDecisionAggregateAttachmentRequest request,
            CancellationToken cancellationToken = default)
        {
            LastAggregateAttachmentRequest = request;
            if (ThrowAggregateAttachment)
            {
                throw new InvalidOperationException("synthetic attachment exception");
            }

            var execution = FailAggregateAttachment
                ? ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                    @"D:\repo\tools\visual-evidence\attach-delivery-decision-aggregate.mjs",
                    1,
                    DateTimeOffset.Now,
                    DateTimeOffset.Now,
                    "synthetic attachment failure")
                : Success(
                    ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                    @"D:\repo\tools\visual-evidence\attach-delivery-decision-aggregate.mjs");
            if (FailAggregateAttachment)
            {
                return new DeliveryDecisionAggregateAttachmentResult(execution, null);
            }

            var verification = await VerifyDeliveryDecisionAggregateAttachmentAsync(
                new DeliveryDecisionAggregateAttachmentVerificationRequest(
                    request.DeliveryManifestPath),
                cancellationToken);
            return new DeliveryDecisionAggregateAttachmentResult(execution, verification);
        }

        public Task<ReviewQueueProjectionResult> ProjectReviewQueueAsync(
            ReviewQueueProjectionRequest request,
            CancellationToken cancellationToken = default)
        {
            LastReviewQueueRequest = request;
            var execution = Success(
                ToolchainScriptKind.ProjectReviewQueue,
                @"D:\repo\tools\review-queue\review-queue-projector.mjs");
            if (RejectReviewQueueProjection)
            {
                return Task.FromResult(new ReviewQueueProjectionResult(
                    execution,
                    new ReviewQueueProjection(
                        false,
                        "local_verified_projection",
                        request.ArtifactPaths.Count,
                        0,
                        0,
                        0,
                        [],
                        [new ReviewQueueRejectedSource(request.ArtifactPaths[0], "synthetic rejection")])));
            }
            var items = new[]
            {
                new ReviewQueueItem(
                    "needs_human_label",
                    "feedback-parse-result",
                    "feedback-001",
                    "math-answer",
                    request.ArtifactPaths[0],
                    new string('a', 64),
                    "ambiguous_error_signal"),
                new ReviewQueueItem(
                    "high_risk_approval",
                    "decision-record",
                    "decision-001",
                    "math-answer",
                    request.ArtifactPaths[1],
                    new string('b', 64),
                    "high_risk_visual")
            };
            return Task.FromResult(new ReviewQueueProjectionResult(
                execution,
                new ReviewQueueProjection(
                    true,
                    "local_verified_projection",
                    request.ArtifactPaths.Count,
                    1,
                    1,
                    0,
                    items,
                    [])));
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
