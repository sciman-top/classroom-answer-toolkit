using System.Text.Json;
using ClassroomToolkit.App.Delivery;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class LocalToolchainOrchestratorTests
{
    [Theory]
    [InlineData("{\"evalCaseCount\":2147483648}")]
    [InlineData("{\"evalCaseCount\":1.5}")]
    [InlineData("{\"evalCaseCount\":-1}")]
    [InlineData("{\"evalCaseCount\":\"bad\"}")]
    [InlineData("[]")]
    public async Task GetWorkspaceHealthReportAsync_MalformedReportDegradesToDiagnostics(string json)
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, healthJson: json);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var health = await orchestrator.GetWorkspaceHealthReportAsync();

        health.IsHealthy.Should().BeFalse();
        health.Issues.Should().ContainSingle(issue => issue.Contains("健康检查工具不可用"));
    }

    [Fact]
    public async Task GetWorkspaceHealthReportAsync_ParsesTheNodeRegistryReport()
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

        var health = await orchestrator.GetWorkspaceHealthReportAsync("junior-physics-answer");

        health.IsHealthy.Should().BeTrue(health.Summary);
        health.PrimarySubjectPack.Should().Be("junior-physics-answer");
        health.EvalCaseCount.Should().Be(15);
        runner.Arguments[0].Should().EndWith("workspace-health.mjs");
        runner.Arguments.Should().Contain("--subject-pack");
    }

    [Fact]
    public async Task GetWorkspaceHealthReportAsync_DegradesToDiagnostics_WhenNodeToolFails()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, healthExitCode: 1, healthError: "node unavailable");
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var health = await orchestrator.GetWorkspaceHealthReportAsync();

        health.IsHealthy.Should().BeFalse();
        health.Issues.Should().ContainSingle(issue => issue.Contains("健康检查工具失败"));
        health.SubjectPacks.Should().Contain("junior-physics-answer");
    }

    [Fact]
    public async Task GetWorkspaceHealthReportAsync_PropagatesCallerCancellation()
    {
        using var workspace = new TemporaryWorkspace();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            new CanceledHealthRunner());

        var action = () => orchestrator.GetWorkspaceHealthReportAsync(cancellationToken: cancellation.Token);

        await action.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task PackagedRuntime_UsesBundledNodeAndDoesNotInvokePowerShellBootstrap()
    {
        using var workspace = new TemporaryWorkspace();
        var nodePath = Path.Combine(workspace.Root, "runtime", "node", "node.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(nodePath)!);
        File.WriteAllText(nodePath, "node");
        File.WriteAllText(Path.Combine(workspace.Root, "runtime-manifest.json"), "{\"distributionMode\":\"portable\"}");
        var runner = new DeliveryRunner(workspace.Root, healthJson: """
            {
              "primarySubjectPack":"junior-physics-answer",
              "subjectPacks":["junior-physics-answer"],
              "snapshotExists":true,
              "evalOk":true,
              "evalCaseCount":1,
              "summary":"ready",
              "issues":[]
            }
            """);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        await orchestrator.GetWorkspaceHealthReportAsync();
        var bootstrap = await orchestrator.RunBootstrapAsync();

        runner.FileName.Should().Be(nodePath);
        bootstrap.Succeeded.Should().BeTrue();
        bootstrap.Output.Should().Contain("无需执行开发环境 bootstrap");
        runner.CallCount.Should().Be(1);
    }

    [Fact]
    public async Task PackagedRuntimeWithoutBundledNode_FailsClosed()
    {
        using var workspace = new TemporaryWorkspace();
        File.WriteAllText(Path.Combine(workspace.Root, "runtime-manifest.json"), "{\"distributionMode\":\"portable\"}");
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var health = await orchestrator.GetWorkspaceHealthReportAsync();
        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false));

        health.IsHealthy.Should().BeFalse();
        health.Summary.Should().Contain("bundled Node.js");
        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("bundled Node.js");
        delivery.Should().BeNull();
        runner.CallCount.Should().Be(0);
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
        delivery.ReviewDirectoryPath.Should().Be(Path.Combine(workspace.Root, "answer.review"));
        runner.FileName.Should().Be("node");
        runner.Arguments[0].Should().EndWith("deliver-answer.mjs");
        runner.Arguments.Should().Contain("--keep-review");
    }

    [Fact]
    public async Task DeliverForwardsProgressSinkToTheProcessRunner()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);
        var progressLines = new List<string>();

        await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(workspace.MarkdownPath, workspace.PdfPath, "classroom", false),
            default,
            progressLines.Add);

        runner.LastOutputLineSink.Should().NotBeNull();
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

    [Fact]
    public async Task DevelopmentWorkspace_RunCheckAsyncSplicesCoreModeArguments()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, healthReport) = await orchestrator.RunCheckAsync("junior-physics-answer");

        // The dev-machine main path for the app's check button: pwsh + check
        // script with -Mode Core and the requested subject pack, no health
        // report shortcut (that is a packaged-runtime-only optimization).
        execution.Succeeded.Should().BeTrue();
        healthReport.Should().BeNull();
        runner.FileName.Should().Be("pwsh");
        runner.Arguments.Should().Contain("-NoProfile");
        runner.Arguments.Should().Contain("-ExecutionPolicy");
        runner.Arguments.Should().Contain("Bypass");
        runner.Arguments[4].Should().EndWith("check-toolchain.ps1");
        runner.Arguments.Should().Contain("-Mode");
        runner.Arguments.Should().Contain("Core");
        runner.Arguments.Should().Contain("-SubjectPack");
        runner.Arguments.Should().Contain("junior-physics-answer");
    }

    [Fact]
    public async Task DevelopmentWorkspace_RunCheckAsyncMapsNonZeroExitToFailure()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, scriptExitCode: 1, scriptOutput: "gate failed");
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, _) = await orchestrator.RunCheckAsync("junior-physics-answer");

        execution.Succeeded.Should().BeFalse();
        execution.ExitCode.Should().Be(1);
        execution.Output.Should().Contain("gate failed");
    }

    [Fact]
    public async Task DeliverFailsWhenManifestPostdatesTheCurrentRun()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(
            workspace.Root,
            generatedAt: DateTimeOffset.UtcNow.AddMinutes(1));
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        // A future timestamp means the manifest belongs to another run; without
        // the upper bound a stale file from a parallel delivery could pass.
        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("was not generated by this run");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task DeliverFailsWhenManifestIsNotMarkedComplete()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, manifestDeliveryComplete: false);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("does not mark the PDF as complete");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task DeliverFailsWhenManifestOutputDoesNotMatchRequest()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root, manifestOutputPath: "other-answer.pdf");
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", false, "junior-physics-answer"));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("manifest output does not match");
        delivery.Should().BeNull();
    }

    [Fact]
    public async Task LiveWorkflowBindsSourcePdfToTheLiveWorkflowScript()
    {
        using var workspace = new TemporaryWorkspace();
        var sourcePath = Path.Combine(workspace.Root, "exam.pdf");
        var outputDirectory = Path.Combine(workspace.Root, "workflow-output");
        File.WriteAllText(sourcePath, "%PDF-source");
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            runner);

        var (execution, result) = await orchestrator.RunLiveWorkflowAsync(
            new LiveAnswerWorkflowRequest(
                sourcePath,
                outputDirectory,
                null,
                "junior-physics-answer",
                "classroom",
                false,
                true,
                true,
                false));

        execution.Succeeded.Should().BeTrue(execution.Output);
        result.Should().NotBeNull();
        var workflowArguments = runner.Invocations.Single((invocation) =>
            invocation.Any((argument) =>
                argument.EndsWith("run-live-answer-workflow.ps1", StringComparison.OrdinalIgnoreCase)));
        workflowArguments.Should().Contain("-SourcePdf");
        workflowArguments.Should().Contain(sourcePath);
        workflowArguments.Should().Contain("-AllowCloudEgress");
        result!.OutputPdfPath.Should().EndWith("exam参考答案.pdf");
    }

    [Fact]
    public async Task LiveWorkflowRejectsExperimentalPackBeforeStartingTheScript()
    {
        using var workspace = new TemporaryWorkspace();
        var mathPackRoot = Path.Combine(workspace.Root, "prompts", "math-answer");
        Directory.CreateDirectory(mathPackRoot);
        File.WriteAllText(
            Path.Combine(mathPackRoot, "manifest.json"),
            "{\"assetId\":\"math-answer\",\"kind\":\"subject-pack\",\"workflow\":{\"liveAnswers\":false,\"requiresExplicitCloudEgress\":true}}");
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            runner);

        var (execution, result) = await orchestrator.RunLiveWorkflowAsync(
            new LiveAnswerWorkflowRequest(
                workspace.MarkdownPath,
                Path.Combine(workspace.Root, "math-output"),
                null,
                "math-answer",
                "classroom",
                false,
                true,
                false,
                false));

        execution.Succeeded.Should().BeFalse();
        execution.Output.Should().Contain("not enabled for live answer workflows");
        result.Should().BeNull();
        runner.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task LiveWorkflowBaseNamePreservesCjkSourceName()
    {
        using var workspace = new TemporaryWorkspace();
        var sourcePath = Path.Combine(workspace.Root, "2025广州中考.pdf");
        var outputDirectory = Path.Combine(workspace.Root, "workflow-output");
        File.WriteAllText(sourcePath, "%PDF-source");
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(workspace.Root),
            runner);

        var (execution, _) = await orchestrator.RunLiveWorkflowAsync(
            new LiveAnswerWorkflowRequest(
                sourcePath,
                outputDirectory,
                null,
                "junior-physics-answer",
                "classroom",
                false,
                true,
                false,
                false));

        execution.Succeeded.Should().BeTrue(execution.Output);
        File.Exists(Path.Combine(outputDirectory, "2025广州中考.workflow-run.json")).Should().BeTrue();
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
        private readonly string? _manifestOutputPath;
        private readonly bool _manifestDeliveryComplete;
        private readonly int _scriptExitCode;
        private readonly string? _scriptOutput;
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
            string? manifestOutputPath = null,
            bool manifestDeliveryComplete = true,
            int scriptExitCode = 0,
            string? scriptOutput = null,
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
            _manifestOutputPath = manifestOutputPath;
            _manifestDeliveryComplete = manifestDeliveryComplete;
            _scriptExitCode = scriptExitCode;
            _scriptOutput = scriptOutput;
            _healthJson = healthJson;
            _healthExitCode = healthExitCode;
            _healthError = healthError;
        }
        public IReadOnlyList<string> Arguments { get; private set; } = [];
        public List<IReadOnlyList<string>> Invocations { get; } = [];
        public string FileName { get; private set; } = string.Empty;
        public int CallCount { get; private set; }
        public Action<string>? LastOutputLineSink { get; private set; }

        public Task<ProcessRunResult> RunAsync(string fileName, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken = default, TimeSpan? timeout = null, Action<string>? onOutputLine = null)
        {
            CallCount += 1;
            Invocations.Add(arguments);
            FileName = fileName;
            Arguments = arguments;
            LastOutputLineSink = onOutputLine;
            if (arguments.Count > 0 && arguments[0].EndsWith("workspace-health.mjs", StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(new ProcessRunResult(
                    _healthExitCode,
                    _healthJson ?? "{}",
                    _healthError ?? ""));
            }

            if (arguments.Count > 0 && arguments[0].EndsWith("validate-workflow-receipt.mjs", StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(new ProcessRunResult(0, "Validated workflow receipt.", ""));
            }
            if (arguments.Count > 0 && arguments[0] == "-NoProfile")
            {
                if (arguments.Any((argument) =>
                    argument.EndsWith("run-live-answer-workflow.ps1", StringComparison.OrdinalIgnoreCase)))
                {
                    return FulfillLiveWorkflowAsync(arguments);
                }
                // The pwsh script path (bootstrap/check): no artifacts to fake.
                return Task.FromResult(new ProcessRunResult(_scriptExitCode, _scriptOutput ?? "", ""));
            }

            var pdfPath = arguments[2];
            File.WriteAllText(pdfPath, "%PDF-test");
            var manifestPath = Path.Combine(Path.GetDirectoryName(pdfPath)!, $"{Path.GetFileNameWithoutExtension(pdfPath)}.delivery-manifest.json");
            if (!_writeManifest)
            {
                return Task.FromResult(new ProcessRunResult(0, "ok", ""));
            }

            if (_invalidManifest)
            {
                File.WriteAllText(manifestPath, "{ invalid json");
                return Task.FromResult(new ProcessRunResult(0, "ok", ""));
            }

            // input/output are written as literal manifest-relative paths: the
            // portability contract (2026-08-27) requires the orchestrator to
            // resolve them against the manifest directory. (A post-serialize
            // .Replace could never match — JsonSerializer escapes the backslashes.)
            File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
            {
                generatedAt = _generatedAt ?? DateTimeOffset.UtcNow,
                subjectPack = _manifestSubjectPack,
                input = _manifestInputPath ?? "answer.md",
                output = _manifestOutputPath ?? Path.GetFileName(pdfPath),
                snapshotId = "snapshot-test",
                snapshotPath = ".snapshot-cache/resolved-snapshot.json",
                snapshot = new { version = "v8.14" },
                profile = _manifestProfile,
                review = new
                {
                    outputDir = "answer.review"
                },
                status = new { deliveryComplete = _manifestDeliveryComplete }
            }));
            return Task.FromResult(new ProcessRunResult(0, "ok", ""));
        }

        private Task<ProcessRunResult> FulfillLiveWorkflowAsync(IReadOnlyList<string> arguments)
        {
            string Option(string name)
            {
                var index = arguments.ToList().IndexOf(name);
                return index >= 0 && index + 1 < arguments.Count ? arguments[index + 1] : "";
            }
            var sourcePath = Option("-SourcePdf");
            var outputDirectory = Option("-OutputDirectory");
            Directory.CreateDirectory(outputDirectory);
            var baseName = Path.GetFileNameWithoutExtension(sourcePath);
            var answerPath = Path.Combine(outputDirectory, $"{baseName}参考答案.md");
            var pdfPath = Path.Combine(outputDirectory, $"{baseName}参考答案.pdf");
            var manifestPath = Path.Combine(outputDirectory, $"{baseName}参考答案.delivery-manifest.json");
            File.WriteAllText(answerPath, "# 参考答案\n");
            File.WriteAllText(pdfPath, "%PDF-test");
            File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
            {
                generatedAt = DateTimeOffset.UtcNow,
                subjectPack = "junior-physics-answer",
                input = "answer.md",
                output = Path.GetFileName(pdfPath),
                snapshotId = "snapshot-test",
                profile = "classroom",
                review = new { outputDir = "answer.review", manifestPath = "answer.review/manifest.json" },
                status = new { deliveryComplete = true }
            }));
            File.WriteAllText(Path.Combine(outputDirectory, $"{baseName}.workflow-run.json"), JsonSerializer.Serialize(new
            {
                kind = "live-answer-workflow-run",
                status = "succeeded",
                finishedAt = DateTimeOffset.UtcNow,
                phases = new
                {
                    delivery = new
                    {
                        status = "completed",
                        artifactPath = pdfPath
                    }
                }
            }));
            return Task.FromResult(new ProcessRunResult(0, "live workflow fixture", ""));
        }
    }

    private sealed class CanceledHealthRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default,
            TimeSpan? timeout = null,
            Action<string>? onOutputLine = null) => Task.FromCanceled<ProcessRunResult>(cancellationToken);
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), $"classroom-toolkit-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            Directory.CreateDirectory(Path.Combine(Root, "tools", "latex-renderer"));
            Directory.CreateDirectory(Path.Combine(Root, "tools", "rule-compiler"));
            Directory.CreateDirectory(Path.Combine(Root, "prompts", "junior-physics-answer"));
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "run-live-answer-workflow.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "tools", "latex-renderer", "deliver-answer.mjs"), "");
            File.WriteAllText(Path.Combine(Root, "tools", "rule-compiler", "validate-workflow-receipt.mjs"), "");
            File.WriteAllText(Path.Combine(Root, "prompts", "junior-physics-answer", "manifest.json"), "{\"assetId\":\"junior-physics-answer\",\"kind\":\"subject-pack\",\"workflow\":{\"liveAnswers\":true,\"requiresExplicitCloudEgress\":true}}");
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
