using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class LocalToolchainOrchestratorTests
{
    [Fact]
    public void GetWorkspaceHealthReport_ReturnsHealthyState_WhenWorkspaceIsAligned()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new FakeProcessRunner());

        var result = orchestrator.GetWorkspaceHealthReport();

        result.IsHealthy.Should().BeTrue();
        result.EvalCaseCount.Should().Be(5);
        result.LatestProductionSpecVersion.Should().Be("v11.1");
    }

    [Fact]
    public async Task RunDeliverAsync_PreservesSnapshotId_FromWrittenDeliveryManifest()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();
        workspace.WriteDeliveryManifest("snapshot-test");

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new FakeDeliverProcessRunner());

        var (execution, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: true,
                SubjectPack: "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        execution.ScriptPath.Should().EndWith(@"tools\latex-renderer\deliver-answer.mjs");
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().Be("snapshot-test");
        delivery.SubjectPack.Should().Be("junior-physics-answer");
        delivery.Profile.Should().Be("classroom");
        delivery.SnapshotPath.Should().Be("D:\\repo\\.snapshot-cache\\resolved-snapshot.json");
        delivery.SnapshotVersion.Should().Be("v11.1");
        delivery.ReviewLifecycleState.Should().Be("ready_for_review");
        delivery.VisualDecisionPath.Should().Be(Path.Combine(workspace.Root, "review", "decision-001.json"));
        delivery.VisualReviewPassed.Should().BeNull();
        delivery.Trusted.Should().BeFalse();
    }

    [Fact]
    public async Task RunDeliverAsync_RejectsNonJsonVisualDecisionReference()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            resolver,
            new FakeDeliverProcessRunner("review/decision-001.exe"));

        var (_, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: true,
                SubjectPack: "junior-physics-answer"));

        delivery.Should().NotBeNull();
        delivery!.VisualDecisionPath.Should().BeNull();
        delivery.Trusted.Should().BeFalse();
    }

    [Fact]
    public async Task RunDeliverAsync_KeepsAggregateAttachmentFailClosed_UntilSourceAwareVerificationIsIntegrated()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            resolver,
            new FakeDeliverProcessRunner(includeAggregateAttachment: true));

        var (_, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: true,
                SubjectPack: "junior-physics-answer"));

        delivery.Should().NotBeNull();
        delivery!.VisualReviewPassed.Should().BeNull();
        delivery.Trusted.Should().BeFalse();
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"malformed\"")]
    [InlineData("[]")]
    public async Task RunDeliverAsync_KeepsMalformedAggregateAttachmentFailClosed(string attachmentJson)
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            resolver,
            new FakeDeliverProcessRunner(aggregateAttachmentJson: attachmentJson));

        var (_, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: true,
                SubjectPack: "junior-physics-answer"));

        delivery.Should().NotBeNull();
        delivery!.VisualReviewPassed.Should().BeNull();
        delivery.Trusted.Should().BeFalse();
    }

    [Fact]
    public async Task RunDeliverAsync_PassesPrimarySubjectPack_ToDeliverScript()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("math-answer", "v0.1", status: "experimental");
        workspace.WriteConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WriteSnapshot("math-answer", "v0.1", "classroom");
        workspace.WriteEval("math-answer", "v0.1", ok: true, caseCount: 2);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();
        workspace.WriteDeliveryManifest("snapshot-math");

        var processRunner = new CapturingDeliverProcessRunner();
        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, processRunner);

        var (execution, _) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: false));

        execution.Succeeded.Should().BeTrue();
        processRunner.LastArguments.Should().NotBeNull();
        processRunner.LastArguments.Should().Contain("--subject-pack");
        processRunner.LastArguments.Should().Contain("math-answer");
    }

    [Fact]
    public async Task RunDeliverAsync_DoesNotTrustLegacyTopLevelSnapshotId_WhenSnapshotBlockIsMissing()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new LegacyTopLevelSnapshotIdProcessRunner());

        var (execution, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: false,
                SubjectPack: "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().BeNull();
    }

    [Fact]
    public async Task AttachVisualDecisionAsync_InvokesAdapter_AndRefreshesManifestState()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        workspace.WriteDecisionRecord();
        var processRunner = new FakeAttachmentProcessRunner();
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            processRunner);

        var result = await orchestrator.AttachVisualDecisionAsync(
            new VisualDecisionAttachmentRequest(
                workspace.DeliveryManifestPath,
                workspace.DecisionRecordPath));

        result.Execution.Succeeded.Should().BeTrue();
        result.Execution.Kind.Should().Be(ToolchainScriptKind.AttachVisualDecision);
        processRunner.LastArguments.Should().ContainInOrder(
            "--prefix",
            Path.Combine(workspace.Root, "tools", "visual-evidence"),
            "run",
            "attach:decision",
            "--",
            "--manifest",
            workspace.DeliveryManifestPath,
            "--decision",
            workspace.DecisionRecordPath);
        result.Delivery.Should().NotBeNull();
        result.Delivery!.VisualDecisionPath.Should().Be(workspace.DecisionRecordPath);
        result.Delivery.VisualReviewPassed.Should().BeFalse();
        result.Delivery.Trusted.Should().BeFalse();
        result.Delivery.ReviewLifecycleState.Should().Be("ready_for_review");
    }

    [Fact]
    public async Task AttachVisualDecisionAsync_ReturnsNoDelivery_WhenAdapterFails()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        workspace.WriteDecisionRecord();
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new FailingAttachmentProcessRunner());

        var result = await orchestrator.AttachVisualDecisionAsync(
            new VisualDecisionAttachmentRequest(
                workspace.DeliveryManifestPath,
                workspace.DecisionRecordPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(2);
        result.Execution.Output.Should().Contain("subjectPack mismatch");
        result.Delivery.Should().BeNull();
    }

    [Fact]
    public async Task AttachVisualDecisionAsync_RejectsNonJsonInput_BeforeStartingProcess()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var invalidDecisionPath = Path.Combine(workspace.Root, "decision.txt");
        File.WriteAllText(invalidDecisionPath, "{}");
        var processRunner = new CapturingProcessRunner();
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            processRunner);

        var result = await orchestrator.AttachVisualDecisionAsync(
            new VisualDecisionAttachmentRequest(
                workspace.DeliveryManifestPath,
                invalidDecisionPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.Output.Should().Contain("must be a JSON file");
        result.Delivery.Should().BeNull();
        processRunner.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task AttachVisualDecisionAsync_Fails_WhenProcessDoesNotAttachRequestedDecision()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        workspace.WriteDecisionRecord();
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new CapturingProcessRunner());

        var result = await orchestrator.AttachVisualDecisionAsync(
            new VisualDecisionAttachmentRequest(
                workspace.DeliveryManifestPath,
                workspace.DecisionRecordPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-2);
        result.Execution.Output.Should().Contain("does not reference the requested DecisionRecord");
        result.Delivery.Should().BeNull();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_InvokesReadOnlyVerifier_AndParsesTypedResult()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        workspace.WriteTrustedAggregateAttachment();
        var processRunner = new AggregateVerificationProcessRunner(
            BuildAggregateVerificationOutput(workspace.DeliveryManifestPath));
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            processRunner);

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeTrue();
        result.Execution.Kind.Should().Be(ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment);
        processRunner.LastFileName.Should().Be("node");
        processRunner.LastArguments.Should().ContainInOrder(
            Path.Combine(
                workspace.Root,
                "tools",
                "visual-evidence",
                "verify-delivery-decision-aggregate-attachment.mjs"),
            "--manifest",
            workspace.DeliveryManifestPath);
        result.Verification.Should().NotBeNull();
        result.Verification!.ManifestPath.Should().Be(workspace.DeliveryManifestPath);
        result.Verification.AggregatePath.Should().Be(Path.Combine(workspace.Root, "aggregate.json"));
        result.Verification.PreimageBackupPath.Should().Be(Path.Combine(workspace.Root, "manifest.before.json"));
        result.Verification.ReceiptPath.Should().Be(Path.Combine(workspace.Root, "receipt.json"));
        result.Verification.AttachmentId.Should().Be("aggregate-attachment-test");
        result.Verification.ManifestPreimageSha256.Should().Be(new string('a', 64));
        result.Verification.ManifestResultSha256.Should().Be(ComputeSha256(workspace.DeliveryManifestPath));
        result.Verification.VisualReviewPassed.Should().BeTrue();
        result.Verification.Trusted.Should().BeTrue();
        result.Delivery.Should().NotBeNull();
        result.Delivery!.VisualReviewPassed.Should().BeTrue();
        result.Delivery.Trusted.Should().BeTrue();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_FailsClosed_WhenManifestBytesDriftAfterVerifier()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        workspace.WriteTrustedAggregateAttachment();
        var verifierOutput = BuildAggregateVerificationOutput(workspace.DeliveryManifestPath);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new AggregateVerificationProcessRunner(
                verifierOutput,
                afterRun: () => File.AppendAllText(workspace.DeliveryManifestPath, Environment.NewLine)));

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-2);
        result.Execution.Output.Should().Contain("bytes changed after source-aware verification");
        result.Verification.Should().BeNull();
        result.Delivery.Should().BeNull();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_ReturnsNoVerification_WhenVerifierFails()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new AggregateVerificationProcessRunner(
                string.Empty,
                exitCode: 1,
                standardError: "Aggregate attachment hash chain does not match referenced artifacts."));

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(1);
        result.Execution.Output.Should().Contain("hash chain");
        result.Verification.Should().BeNull();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_ReturnsTypedFailure_WhenProcessCannotStart()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new ThrowingProcessRunner(new InvalidOperationException("node executable not found")));

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-3);
        result.Execution.Output.Should().Contain("node executable not found");
        result.Verification.Should().BeNull();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_PropagatesCancellation()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new ThrowingProcessRunner(new OperationCanceledException()));

        var action = () => orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        await action.Should().ThrowAsync<OperationCanceledException>();
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("{}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\"}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\"} {\"trusted\":true}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\",\"kind\":\"delivery-decision-aggregate-attachment\"}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\",\"unexpected\":true}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\",\"manifestPath\":\"C:\\\\other.json\",\"aggregatePath\":\"C:\\\\aggregate.json\",\"preimageBackupPath\":\"C:\\\\before.json\",\"receiptPath\":\"C:\\\\receipt.json\",\"attachmentId\":\"id\",\"manifestPreimageSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"manifestResultSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"visualReviewPassed\":true,\"trusted\":true}")]
    [InlineData("{\"kind\":\"delivery-decision-aggregate-attachment\",\"manifestPath\":\"C:\\\\manifest.json\",\"aggregatePath\":\"C:\\\\aggregate.json\",\"preimageBackupPath\":\"C:\\\\before.json\",\"receiptPath\":\"C:\\\\receipt.json\",\"attachmentId\":\"id\",\"manifestPreimageSha256\":\"invalid\",\"manifestResultSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"visualReviewPassed\":true,\"trusted\":true}")]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_FailsClosed_OnMalformedOrMismatchedOutput(
        string standardOutput)
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new AggregateVerificationProcessRunner(standardOutput));

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-2);
        result.Execution.Output.Should().Contain("output was rejected");
        result.Verification.Should().BeNull();
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_FailsClosed_WhenVerifierDoesNotReportPositiveTrust()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        workspace.WriteDeliveryManifest("snapshot-test");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new AggregateVerificationProcessRunner(
                BuildAggregateVerificationOutput(workspace.DeliveryManifestPath, trusted: false)));

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.DeliveryManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-2);
        result.Execution.Output.Should().Contain("trusted must be true");
        result.Verification.Should().BeNull();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\0")]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_RejectsInvalidPath_BeforeStartingProcess(
        string manifestPath)
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        var processRunner = new AggregateVerificationProcessRunner(string.Empty);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            processRunner);

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(manifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-1);
        result.Verification.Should().BeNull();
        processRunner.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task VerifyDeliveryDecisionAggregateAttachmentAsync_RejectsNonJsonInput_BeforeStartingProcess()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSupportFiles();
        var invalidManifestPath = Path.Combine(workspace.Root, "manifest.txt");
        File.WriteAllText(invalidManifestPath, "{}");
        var processRunner = new AggregateVerificationProcessRunner(string.Empty);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            processRunner);

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(invalidManifestPath));

        result.Execution.Succeeded.Should().BeFalse();
        result.Execution.ExitCode.Should().Be(-1);
        result.Execution.Output.Should().Contain("must be a JSON file");
        result.Verification.Should().BeNull();
        processRunner.CallCount.Should().Be(0);
    }

    private sealed class FakeProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class FakeDeliverProcessRunner : IProcessRunner
    {
        private readonly string _visualDecisionRef;
        private readonly bool _includeAggregateAttachment;
        private readonly string? _aggregateAttachmentJson;

        public FakeDeliverProcessRunner(
            string visualDecisionRef = "review/decision-001.json",
            bool includeAggregateAttachment = false,
            string? aggregateAttachmentJson = null)
        {
            _visualDecisionRef = visualDecisionRef;
            _includeAggregateAttachment = includeAggregateAttachment;
            _aggregateAttachmentJson = aggregateAttachmentJson;
        }

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase)
                && arguments.Count >= 4
                && arguments[0] == "--prefix"
                && arguments[2] == "run"
                && arguments[3] == "deliver")
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");

                var manifest = new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    generatedAt = "2026-06-18T00:00:00Z",
                    subjectPack = "junior-physics-answer",
                    snapshotId = "snapshot-test",
                    snapshotPath = "D:\\repo\\.snapshot-cache\\resolved-snapshot.json",
                    snapshot = new
                    {
                        id = "snapshot-test",
                        version = "v11.1",
                        profile = "classroom"
                    },
                    profile = "classroom",
                    input = "D:\\repo\\sample-answer.md",
                    output = "D:\\repo\\sample-answer.pdf",
                    review = new
                    {
                        outputDir = "D:\\repo\\.pdf-review\\sample-answer",
                        manifestPath = "D:\\repo\\.pdf-review\\sample-answer\\manifest.json",
                        scale = "2",
                        lifecycle = new
                        {
                            state = "ready_for_review",
                            updatedAt = "2026-06-18T00:00:00Z"
                        },
                        visualDecisionRef = _visualDecisionRef
                    },
                    status = new
                    {
                        toolchainPassed = true,
                        deliveryComplete = true,
                        reviewArtifactReady = true,
                        visualReviewPassed = (bool?)null,
                        trusted = false
                    }
                };

                var manifestNode = JsonSerializer.SerializeToNode(manifest)!.AsObject();
                if (_includeAggregateAttachment)
                {
                    manifestNode["review"]!["deliveryDecisionAggregateAttachment"] = new JsonObject
                    {
                        ["attachmentId"] = "attachment-test",
                        ["aggregateRef"] = "aggregate.json",
                        ["aggregateSha256"] = new string('a', 64),
                        ["manifestPreimageSha256"] = new string('b', 64),
                        ["preimageBackupRef"] = "manifest.before.json",
                        ["receiptRef"] = "receipt.json"
                    };
                    manifestNode["status"]!["visualReviewPassed"] = true;
                    manifestNode["status"]!["trusted"] = true;
                }
                else if (_aggregateAttachmentJson is not null)
                {
                    manifestNode["review"]!["deliveryDecisionAggregateAttachment"] =
                        JsonNode.Parse(_aggregateAttachmentJson);
                    manifestNode["status"]!["visualReviewPassed"] = true;
                    manifestNode["status"]!["trusted"] = true;
                }

                File.WriteAllText(manifestPath, manifestNode.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class CapturingDeliverProcessRunner : IProcessRunner
    {
        public IReadOnlyList<string>? LastArguments { get; private set; }

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            LastArguments = arguments.ToArray();

            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase))
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    subjectPack = "math-answer",
                    snapshotId = "snapshot-math",
                    snapshot = new
                    {
                        id = "snapshot-math",
                        version = "v0.1",
                        profile = "classroom"
                    }
                }, new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class FakeAttachmentProcessRunner : IProcessRunner
    {
        public IReadOnlyList<string> LastArguments { get; private set; } = [];

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            LastArguments = arguments.ToArray();
            var manifestPath = arguments[6];
            var decisionPath = arguments[8];
            var manifest = JsonNode.Parse(File.ReadAllText(manifestPath))!.AsObject();
            manifest["review"]!["visualDecisionRef"] = decisionPath;
            manifest["status"]!["visualReviewPassed"] = false;
            manifest["status"]!["trusted"] = false;
            File.WriteAllText(manifestPath, manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            return Task.FromResult(new ProcessRunResult(0, "{\"changed\":true}", string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class FailingAttachmentProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new ProcessRunResult(2, string.Empty, "subjectPack mismatch", TimeSpan.Zero));
        }
    }

    private sealed class CapturingProcessRunner : IProcessRunner
    {
        public int CallCount { get; private set; }

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class AggregateVerificationProcessRunner : IProcessRunner
    {
        private readonly string _standardOutput;
        private readonly int _exitCode;
        private readonly string _standardError;
        private readonly Action? _afterRun;

        public AggregateVerificationProcessRunner(
            string standardOutput,
            int exitCode = 0,
            string standardError = "",
            Action? afterRun = null)
        {
            _standardOutput = standardOutput;
            _exitCode = exitCode;
            _standardError = standardError;
            _afterRun = afterRun;
        }

        public int CallCount { get; private set; }

        public string? LastFileName { get; private set; }

        public IReadOnlyList<string> LastArguments { get; private set; } = [];

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            LastFileName = fileName;
            LastArguments = arguments.ToArray();
            _afterRun?.Invoke();
            return Task.FromResult(new ProcessRunResult(
                _exitCode,
                _standardOutput,
                _standardError,
                TimeSpan.Zero));
        }
    }

    private sealed class ThrowingProcessRunner : IProcessRunner
    {
        private readonly Exception _exception;

        public ThrowingProcessRunner(Exception exception)
        {
            _exception = exception;
        }

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            return Task.FromException<ProcessRunResult>(_exception);
        }
    }

    private sealed class LegacyTopLevelSnapshotIdProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase))
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    subjectPack = "junior-physics-answer",
                    snapshotId = "legacy-top-level-only",
                    profile = "classroom"
                }, new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Orchestrator", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string AnswerMarkdownPath => Path.Combine(Root, "sample-answer.md");

        public string DeliveryManifestPath => Path.Combine(Root, "sample-answer.delivery-manifest.json");

        public string DecisionRecordPath => Path.Combine(Root, "review", "decision.json");

        public void WriteRootSpec(string version)
        {
            File.WriteAllText(Path.Combine(Root, $"spec_v{version}_release.md"), $"# v{version}\n");
        }

        public void WriteManifest(string subjectPack, string version, string? humanSpec = null, string status = "active")
        {
            humanSpec ??= BuildCompiledHumanSpecPath(subjectPack, version);
            WriteJson(Path.Combine(Root, "prompts", subjectPack, "manifest.json"), new
            {
                kind = "subject-pack",
                assetId = subjectPack,
                version,
                status,
                sourceOfTruth = new
                {
                    humanSpec,
                    mirroredSpec = "./spec.md",
                    acceptanceChecklist = "./checklists/acceptance.md",
                    runtimeConfig = "./config.json"
                },
                entry = new
                {
                    snapshotCache = subjectPack == "math-answer"
                        ? "../../.snapshot-cache/resolved-snapshot.math.json"
                        : "../../.snapshot-cache/resolved-snapshot.json"
                },
                evaluation = new { resultsDir = $"../../eval/{subjectPack}/results" }
            });
        }

        public void WriteConfig(string subjectPack, string snapshotPath)
        {
            WriteJson(Path.Combine(Root, "prompts", subjectPack, "config.json"), new
            {
                snapshot = new { cachePath = snapshotPath }
            });
        }

        public void WriteSnapshot(string subjectPack, string version, string profile)
        {
            var snapshotFileName = subjectPack == "math-answer"
                ? "resolved-snapshot.math.json"
                : "resolved-snapshot.json";
            WriteJson(Path.Combine(Root, ".snapshot-cache", snapshotFileName), new
            {
                subjectPack = new { version },
                activeProfile = new { name = profile }
            });
        }

        public void WriteEval(string subjectPack, string assetVersion, bool ok, int caseCount)
        {
            WriteJson(Path.Combine(Root, "eval", subjectPack, "results", "latest.json"), new
            {
                assetVersion,
                ok,
                cases = Enumerable.Range(0, caseCount).Select(_ => new { }).ToArray()
            });
        }

        public void WriteAnswerMarkdown()
        {
            var answerPath = AnswerMarkdownPath;
            Directory.CreateDirectory(Path.GetDirectoryName(answerPath)!);
            File.WriteAllText(answerPath, "# sample answer\n");
        }

        public void WriteDeliveryManifest(string snapshotId)
        {
            WriteJson(DeliveryManifestPath, new
            {
                schemaVersion = "1.0",
                kind = "delivery-manifest",
                generatedAt = "2026-06-18T00:00:00Z",
                subjectPack = "junior-physics-answer",
                snapshotId,
                snapshotPath = "../../.snapshot-cache/resolved-snapshot.json",
                snapshot = new
                {
                    id = snapshotId,
                    version = "v11.1",
                    profile = "classroom"
                },
                profile = "classroom",
                input = AnswerMarkdownPath,
                output = Path.ChangeExtension(AnswerMarkdownPath, ".pdf"),
                review = new
                {
                    outputDir = Path.Combine(Root, ".pdf-review", "sample-answer"),
                    manifestPath = Path.Combine(Root, ".pdf-review", "sample-answer", "manifest.json"),
                    scale = "2",
                    lifecycle = new
                    {
                        state = "ready_for_review",
                        updatedAt = "2026-07-25T00:00:00Z"
                    },
                    feedbackRefs = Array.Empty<string>()
                },
                status = new
                {
                    toolchainPassed = true,
                    deliveryComplete = true,
                    reviewArtifactReady = true,
                    visualReviewPassed = (bool?)null,
                    trusted = false
                }
            });
        }

        public void WriteDecisionRecord()
        {
            WriteJson(DecisionRecordPath, new
            {
                schemaVersion = "1.0",
                kind = "decision-record",
                subjectPack = "junior-physics-answer",
                statusProjection = new
                {
                    visualReviewPassed = false,
                    trusted = false
                }
            });
        }

        public void WriteTrustedAggregateAttachment()
        {
            var manifest = JsonNode.Parse(File.ReadAllText(DeliveryManifestPath))!.AsObject();
            manifest["review"]!["deliveryDecisionAggregateAttachment"] = new JsonObject
            {
                ["attachmentId"] = "aggregate-attachment-test",
                ["aggregateRef"] = "aggregate.json",
                ["aggregateSha256"] = new string('c', 64),
                ["manifestPreimageSha256"] = new string('a', 64),
                ["preimageBackupRef"] = "manifest.before.json",
                ["receiptRef"] = "receipt.json"
            };
            manifest["status"]!["visualReviewPassed"] = true;
            manifest["status"]!["trusted"] = true;
            File.WriteAllText(DeliveryManifestPath, manifest.ToJsonString(Indented));
        }

        public void WriteSupportFiles()
        {
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "# bootstrap\n");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "# check\n");
            File.WriteAllText(Path.Combine(Root, "global.json"), "{}\n");
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "solution\n");
        }

        private static void WriteJson(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(value, Indented));
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }

        private static string BuildCompiledHumanSpecPath(string subjectPack, string version)
        {
            return subjectPack switch
            {
                "junior-physics-answer" => $"../specs/compiled/试卷参考答案交付规范-初中物理-完整版-{version}.md",
                "senior-physics-answer" => $"../specs/compiled/试卷参考答案交付规范-高中物理-完整版-{version}.md",
                "math-answer" => $"../specs/compiled/试卷参考答案交付规范-初中数学-完整版-{version}.md",
                _ => $"../specs/compiled/{subjectPack}-full-{version}.md"
            };
        }
    }

    private static string BuildAggregateVerificationOutput(string manifestPath, bool trusted = true)
    {
        var directory = Path.GetDirectoryName(manifestPath)!;
        return JsonSerializer.Serialize(new
        {
            kind = "delivery-decision-aggregate-attachment",
            manifestPath,
            aggregatePath = Path.Combine(directory, "aggregate.json"),
            preimageBackupPath = Path.Combine(directory, "manifest.before.json"),
            receiptPath = Path.Combine(directory, "receipt.json"),
            attachmentId = "aggregate-attachment-test",
            manifestPreimageSha256 = new string('a', 64),
            manifestResultSha256 = ComputeSha256(manifestPath),
            visualReviewPassed = true,
            trusted
        });
    }

    private static string ComputeSha256(string filePath)
    {
        return Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(filePath))).ToLowerInvariant();
    }
}
