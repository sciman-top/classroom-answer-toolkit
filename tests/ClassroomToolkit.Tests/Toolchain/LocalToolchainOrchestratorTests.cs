using System.Text.Json;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class LocalToolchainOrchestratorTests
{
    [Fact]
    public void GetWorkspaceHealthReport_ParsesTheNodeRegistryReport()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, healthJson: """
            {
              "primarySubjectPack": "junior-physics-answer",
              "subjectPacks": ["junior-physics-answer", "math-answer"],
              "latestProductionSpecVersion": "v8.18",
              "assetVersion": "v8.18",
              "snapshotExists": true,
              "snapshotPath": "D:\\repo\\.snapshot-cache\\resolved-snapshot.json",
              "snapshotVersion": "v8.18",
              "snapshotProfile": "classroom",
              "evalExists": true,
              "evalOk": true,
              "evalCaseCount": 15,
              "summary": "规则快照、评测结果与最新规范已对齐。",
              "issues": []
            }
            """);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var health = orchestrator.GetWorkspaceHealthReport("junior-physics-answer");

        health.IsHealthy.Should().BeTrue(health.Summary);
        health.PrimarySubjectPack.Should().Be("junior-physics-answer");
        health.SnapshotVersion.Should().Be("v8.18");
        health.EvalCaseCount.Should().Be(15);
        runner.Arguments[0].Should().EndWith("workspace-health.mjs");
        runner.Arguments.Should().Contain("--subject-pack");
    }

    [Fact]
    public void GetWorkspaceHealthReport_DegradesToDiagnostics_WhenNodeToolFails()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, healthExitCode: 1, healthError: "node unavailable");
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var health = orchestrator.GetWorkspaceHealthReport();

        health.IsHealthy.Should().BeFalse();
        health.Issues.Should().ContainSingle(issue => issue.Contains("健康检查工具失败"));
        health.SubjectPacks.Should().Contain("junior-physics-answer");
    }

    [Fact]
    public async Task DeliverInvokesRendererAndReadsManifest()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", true, "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().Be("snapshot-test");
        delivery.ReviewDirectoryPath.Should().Be(Path.Combine(workspace.Root, ".pdf-review", "answer"));
        runner.FileName.Should().Be("node");
        runner.Arguments[0].Should().EndWith("deliver-answer.mjs");
        runner.Arguments.Should().Contain("--keep-review");
    }

    [Fact]
    public async Task DeliverRejectsMissingMarkdownBeforeProcessStart()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            Path.Combine(workspace.Root, "missing.md"), null, "classroom", false));

        execution.Succeeded.Should().BeFalse();
        delivery.Should().BeNull();
        runner.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task DeliverFailsWhenSuccessfulProcessDoesNotCreateManifest()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, writeManifest: false);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("delivery manifest was not created");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task DeliverFailsWhenManifestIsInvalid()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, invalidManifest: true);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("Delivery manifest is invalid");
        delivery.Should().BeNull();
    }

    [Theory]
    [InlineData("math-answer", "classroom")]
    [InlineData("junior-physics-answer", "compact")]
    public async Task DeliverFailsWhenManifestContextDoesNotMatchRequest(
        string manifestSubjectPack,
        string manifestProfile)
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(
            workspace.Root,
            manifestSubjectPack: manifestSubjectPack,
            manifestProfile: manifestProfile);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("does not match the request");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task DeliverFailsWhenManifestPredatesTheCurrentRun()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(
            workspace.Root,
            generatedAt: DateTimeOffset.UtcNow.AddMinutes(-1));
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("was not generated by this run");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task DeliverFailsWhenManifestInputDoesNotMatchRequest()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(
            workspace.Root,
            manifestInputPath: Path.Combine(workspace.Root, "different-answer.md"));
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("manifest input does not match");
        delivery.Should().BeNull();
    }

    private sealed class DeliveryRunner : IProcessRunner
    {
        private readonly string _root;
        private readonly bool _writeManifest;
        private readonly bool _invalidManifest;
        private readonly string _manifestSubjectPack;
        private readonly string _manifestProfile;
        private readonly DateTimeOffset? _generatedAt;
        private readonly string? _manifestInputPath;
        private readonly string? _healthJson;
        private readonly int _healthExitCode;
        private readonly string? _healthError;

        public DeliveryRunner(
            string root,
            bool writeManifest = true,
            bool invalidManifest = false,
            string manifestSubjectPack = "junior-physics-answer",
            string manifestProfile = "classroom",
            DateTimeOffset? generatedAt = null,
            string? manifestInputPath = null,
            string? healthJson = null,
            int healthExitCode = 0,
            string? healthError = null)
        {
            _root = root;
            _writeManifest = writeManifest;
            _invalidManifest = invalidManifest;
            _manifestSubjectPack = manifestSubjectPack;
            _manifestProfile = manifestProfile;
            _generatedAt = generatedAt;
            _manifestInputPath = manifestInputPath;
            _healthJson = healthJson;
            _healthExitCode = healthExitCode;
            _healthError = healthError;
        }
        public IReadOnlyList<string> Arguments { get; private set; } = [];
        public string FileName { get; private set; } = string.Empty;
        public int CallCount { get; private set; }

        public Task<ProcessRunResult> RunAsync(string fileName, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken = default, TimeSpan? timeout = null)
        {
            CallCount += 1;
            FileName = fileName;
            Arguments = arguments;
            if (arguments.Count > 0 && arguments[0].EndsWith("workspace-health.mjs", StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(new ProcessRunResult(
                    _healthExitCode,
                    _healthJson ?? "{}",
                    _healthError ?? "",
                    TimeSpan.Zero));
            }

            var pdfPath = arguments[2];
            File.WriteAllText(pdfPath, "%PDF-test");
            var manifestPath = Path.Combine(Path.GetDirectoryName(pdfPath)!, $"{Path.GetFileNameWithoutExtension(pdfPath)}.delivery-manifest.json");
            if (!_writeManifest)
            {
                return Task.FromResult(new ProcessRunResult(0, "ok", "", TimeSpan.Zero));
            }

            if (_invalidManifest)
            {
                File.WriteAllText(manifestPath, "{ invalid json");
                return Task.FromResult(new ProcessRunResult(0, "ok", "", TimeSpan.Zero));
            }

            File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
            {
                generatedAt = _generatedAt ?? DateTimeOffset.UtcNow,
                subjectPack = _manifestSubjectPack,
                input = _manifestInputPath ?? arguments[1],
                output = pdfPath,
                snapshotId = "snapshot-test",
                snapshotPath = ".snapshot-cache/resolved-snapshot.json",
                snapshot = new { version = "v8.14" },
                profile = _manifestProfile,
                review = new
                {
                    outputDir = Path.Combine(_root, ".pdf-review", "answer")
                },
                status = new { deliveryComplete = true }
            }));
            return Task.FromResult(new ProcessRunResult(0, "ok", "", TimeSpan.Zero));
        }
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), $"classroom-toolkit-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            Directory.CreateDirectory(Path.Combine(Root, "tools", "latex-renderer"));
            Directory.CreateDirectory(Path.Combine(Root, "prompts", "junior-physics-answer"));
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "tools", "latex-renderer", "deliver-answer.mjs"), "");
            File.WriteAllText(Path.Combine(Root, "prompts", "junior-physics-answer", "manifest.json"), "{\"assetId\":\"junior-physics-answer\",\"kind\":\"subject-pack\"}");
            File.WriteAllText(Path.Combine(Root, "prompts", "junior-physics-answer", "config.json"), "{\"snapshot\":{\"cachePath\":\"../../.snapshot-cache/resolved-snapshot.json\"}}");
            MarkdownPath = Path.Combine(Root, "answer.md");
            PdfPath = Path.Combine(Root, "answer.pdf");
            File.WriteAllText(MarkdownPath, "# 答案");
        }

        public string Root { get; }
        public string MarkdownPath { get; }
        public string PdfPath { get; }
        public void Dispose() => Directory.Delete(Root, true);
    }
}
