using System.Text.Json;
using System.IO;
using ClassroomToolkit.App.Delivery;
using ClassroomToolkit.App.Toolchain;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.Workspace;

namespace ClassroomToolkit.App.Services;

public sealed class LocalToolchainOrchestrator : IToolchainOrchestrator
{
    // Generous hang guards only: bootstrap installs SDKs over slow networks, Full
    // checks run three-subject evals, and deliver drives a headless browser.
    private static readonly TimeSpan BootstrapTimeout = TimeSpan.FromMinutes(45);
    private static readonly TimeSpan CheckTimeout = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan DeliverTimeout = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan LiveWorkflowTimeout = TimeSpan.FromHours(4);
    private static readonly TimeSpan HealthCheckTimeout = TimeSpan.FromMinutes(2);

    private readonly RepositoryRootResolver _repositoryRootResolver;
    private readonly IProcessRunner _processRunner;

    public LocalToolchainOrchestrator(
        RepositoryRootResolver repositoryRootResolver,
        IProcessRunner processRunner)
    {
        _repositoryRootResolver = repositoryRootResolver;
        _processRunner = processRunner;
    }

    public ToolchainWorkspaceInfo GetWorkspaceInfo()
    {
        var repositoryRoot = _repositoryRootResolver.ResolveRepositoryRoot();
        var scriptsDirectory = Path.Combine(repositoryRoot, "scripts");
        // Broken/locked pack manifests would otherwise vanish from the picker with
        // no trace; surface the locator issues on stderr (visible in smoke/console).
        var scanIssues = new List<string>();
        var subjectPacks = WorkspaceSubjectPackLocator.FindSubjectPacks(repositoryRoot, scanIssues);
        foreach (var issue in scanIssues)
        {
            Console.Error.WriteLine($"[toolchain] subject-pack scan issue: {issue}");
        }

        return new ToolchainWorkspaceInfo(
            repositoryRoot,
            Path.Combine(scriptsDirectory, "bootstrap.ps1"),
            Path.Combine(scriptsDirectory, "check-toolchain.ps1"),
            subjectPacks.FirstOrDefault(pack => pack.AssetId == "junior-physics-answer")?.AssetId
                ?? subjectPacks.FirstOrDefault()?.AssetId,
            subjectPacks.Select(pack => pack.AssetId).ToArray());
    }

    public async Task<WorkspaceHealthReport> GetWorkspaceHealthReportAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default)
    {
        var workspace = GetWorkspaceInfo();
        var toolPath = Path.Combine(workspace.RepositoryRoot, "tools", "rule-compiler", "workspace-health.mjs");
        try
        {
            var arguments = new List<string> { toolPath };
            if (!string.IsNullOrWhiteSpace(subjectPack))
            {
                arguments.Add("--subject-pack");
                arguments.Add(subjectPack);
            }

            var process = await _processRunner.RunAsync(
                ResolveNodeExecutable(workspace.RepositoryRoot)
                    ?? throw new InvalidOperationException("安装版 runtime 缺少 bundled Node.js：请修复或重新安装运行时。"),
                arguments,
                workspace.RepositoryRoot,
                cancellationToken,
                HealthCheckTimeout).ConfigureAwait(false);
            if (process.ExitCode != 0)
            {
                return DegradedHealthReport(workspace, subjectPack,
                    $"健康检查工具失败（exit {process.ExitCode}）：{BuildOutput(process.StandardOutput, process.StandardError)}");
            }

            return ReadHealthReport(process.StandardOutput, workspace, subjectPack);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A superseded health probe or app shutdown must be able to stop the
            // Node child process. Treating it as a degraded report keeps obsolete
            // probes running and overwrites the newest workspace state later.
            throw;
        }
        catch (Exception ex) when (ex is InvalidOperationException or TimeoutException or OperationCanceledException
            or IOException or JsonException)
        {
            // node missing, hung, or emitting garbage must degrade to a visible
            // diagnostic instead of breaking the health surface.
            return DegradedHealthReport(workspace, subjectPack, $"健康检查工具不可用：{ex.Message}");
        }
    }

    private static WorkspaceHealthReport ReadHealthReport(
        string json,
        ToolchainWorkspaceInfo workspace,
        string? subjectPack)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("健康检查结果必须是 JSON object。");
        }
        var evalCaseCount = 0;
        if (root.TryGetProperty("evalCaseCount", out var caseCount)
            && (caseCount.ValueKind != JsonValueKind.Number
                || !caseCount.TryGetInt32(out evalCaseCount) || evalCaseCount < 0))
        {
            throw new JsonException("evalCaseCount 必须是非负 Int32。");
        }
        return new WorkspaceHealthReport(
            ReadOptionalString(root, "primarySubjectPack"),
            ReadStringArray(root, "subjectPacks"),
            ReadOptionalString(root, "latestProductionSpecVersion"),
            ReadOptionalString(root, "assetVersion"),
            IsTruthy(root, "snapshotExists"),
            root.TryGetProperty("snapshotPath", out var snapshotPath) && snapshotPath.ValueKind == JsonValueKind.String
                ? snapshotPath.GetString()!
                : string.Empty,
            IsTruthy(root, "evalOk"),
            evalCaseCount,
            root.TryGetProperty("summary", out var summary) && summary.ValueKind == JsonValueKind.String
                ? summary.GetString()!
                : string.Empty,
            ReadStringArray(root, "issues"),
            IsTruthy(root, "aiConfigured", "apiKeyConfigured"),
            IsTruthy(root, "cloudEgressConfigured"));
    }

    private static WorkspaceHealthReport DegradedHealthReport(
        ToolchainWorkspaceInfo workspace,
        string? subjectPack,
        string issue)
    {
        return new WorkspaceHealthReport(
            workspace.PrimarySubjectPack,
            workspace.SubjectPacks,
            null,
            null,
            false,
            string.Empty,
            false,
            0,
            issue,
            [issue],
            false,
            false);
    }

    private static string? ReadOptionalString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.String
            ? element.GetString()
            : null;

    private static bool ReadBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.True;

    private static bool IsTruthy(JsonElement root, params string[] names) =>
        names.Any((name) => ReadBool(root, name));

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.Array
            ? element.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!)
                .ToArray()
            : [];

    public Task<ToolchainExecutionResult> RunBootstrapAsync(
        CancellationToken cancellationToken = default,
        Action<string>? progress = null)
    {
        var workspace = GetWorkspaceInfo();
        if (IsPackagedRuntime(workspace.RepositoryRoot))
        {
            var now = DateTimeOffset.Now;
            return Task.FromResult(ToolchainExecutionResult.Success(
                ToolchainScriptKind.Bootstrap,
                Path.Combine(workspace.RepositoryRoot, "runtime-manifest.json"),
                now,
                now,
                "安装版运行时已随应用配置，无需执行开发环境 bootstrap。"));
        }

        return RunScriptAsync(
            ToolchainScriptKind.Bootstrap,
            workspace.BootstrapScriptPath,
            workspace.RepositoryRoot,
            cancellationToken,
            progress: progress);
    }

    public async Task<(ToolchainExecutionResult Execution, WorkspaceHealthReport? HealthReport)> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null)
    {
        var workspace = GetWorkspaceInfo();
        if (IsPackagedRuntime(workspace.RepositoryRoot))
        {
            var startedAt = DateTimeOffset.Now;
            var report = await GetWorkspaceHealthReportAsync(subjectPack, cancellationToken).ConfigureAwait(false);
            var finishedAt = DateTimeOffset.Now;
            var execution = report.IsHealthy
                ? ToolchainExecutionResult.Success(
                    ToolchainScriptKind.Check,
                    Path.Combine(workspace.RepositoryRoot, "runtime-manifest.json"),
                    startedAt,
                    finishedAt,
                    report.Summary)
                : ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.Check,
                    Path.Combine(workspace.RepositoryRoot, "runtime-manifest.json"),
                    1,
                    startedAt,
                    finishedAt,
                    report.Summary);
            return (execution, report);
        }

        var result = await RunScriptAsync(
            ToolchainScriptKind.Check,
            workspace.CheckScriptPath,
            workspace.RepositoryRoot,
            cancellationToken,
            scriptArguments: string.IsNullOrWhiteSpace(subjectPack)
                ? []
                : ["-Mode", "Core", "-SubjectPack", subjectPack],
            progress: progress).ConfigureAwait(false);
        return (result, null);
    }

    public async Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null)
    {
        var workspace = GetWorkspaceInfo();
        // Relative user input resolves against the workspace root, not the
        // launcher's CWD (Explorer-launched WinExE can start in System32).
        var answerPath = AnswerArtifactPathResolver.ResolveUserPath(request.AnswerMarkdownPath, workspace.RepositoryRoot);
        var toolPath = Path.Combine(workspace.RepositoryRoot, "tools", "latex-renderer", "deliver-answer.mjs");
        var startedAt = DateTimeOffset.Now;

        if (!File.Exists(answerPath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.Deliver, toolPath, -1, startedAt, DateTimeOffset.Now,
                $"Answer Markdown not found: {answerPath}"), null);
        }

        if (!File.Exists(toolPath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.Deliver, toolPath, -1, startedAt, DateTimeOffset.Now,
                $"Renderer tool not found: {toolPath}"), null);
        }

        var outputPath = AnswerArtifactPathResolver.ResolveOutputPdfPath(answerPath, request.OutputPdfPath, workspace.RepositoryRoot);
        var subjectPack = string.IsNullOrWhiteSpace(request.SubjectPack)
            ? workspace.PrimarySubjectPack ?? "junior-physics-answer"
            : request.SubjectPack;
        var arguments = new List<string>
        {
            toolPath, answerPath, outputPath,
            "--subject-pack", subjectPack,
            "--profile", request.Profile
        };
        if (request.KeepReviewArtifacts)
        {
            arguments.Add("--keep-review");
        }

        var nodeExecutable = ResolveNodeExecutable(workspace.RepositoryRoot);
        if (nodeExecutable is null)
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.Deliver,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                "安装版 runtime 缺少 bundled Node.js：请修复或重新安装运行时。"), null);
        }

        var process = await _processRunner.RunAsync(
            nodeExecutable,
            arguments,
            workspace.RepositoryRoot,
            cancellationToken,
            DeliverTimeout,
            progress).ConfigureAwait(false);
        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(process.StandardOutput, process.StandardError);
        var execution = process.ExitCode == 0
            ? ToolchainExecutionResult.Success(ToolchainScriptKind.Deliver, toolPath, startedAt, finishedAt, output)
            : ToolchainExecutionResult.Failure(ToolchainScriptKind.Deliver, toolPath, process.ExitCode, startedAt, finishedAt, output);
        if (!execution.Succeeded)
        {
            return (execution, null);
        }

        var manifestPath = AnswerArtifactPathResolver.ResolveDeliveryManifestPath(outputPath);
        if (!File.Exists(outputPath))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Renderer exited successfully but the PDF was not created: {outputPath}"), null);
        }

        if (!File.Exists(manifestPath))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Renderer exited successfully but the delivery manifest was not created: {manifestPath}"), null);
        }

        ManifestContext context;
        try
        {
            context = ReadManifestContext(manifestPath);
        }
        catch (Exception ex) when (ex is IOException
            or UnauthorizedAccessException
            or JsonException
            or FormatException
            or InvalidOperationException
            or KeyNotFoundException)
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest is invalid: {ex.Message}"), null);
        }

        if (context.GeneratedAt < startedAt.AddSeconds(-2)
            || context.GeneratedAt > finishedAt.AddSeconds(2))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest was not generated by this run: {context.GeneratedAt:O}"), null);
        }

        if (!context.DeliveryComplete)
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                "Delivery manifest does not mark the PDF as complete."), null);
        }

        if (!string.Equals(context.SubjectPack, subjectPack, StringComparison.Ordinal)
            || !string.Equals(context.Profile, request.Profile, StringComparison.Ordinal))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest context does not match the request: {context.SubjectPack}/{context.Profile}."), null);
        }

        if (!string.Equals(
                Path.GetFullPath(context.InputPath),
                answerPath,
                StringComparison.OrdinalIgnoreCase))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest input does not match the requested Markdown: {context.InputPath}"), null);
        }

        if (!string.Equals(
                Path.GetFullPath(context.OutputPath),
                Path.GetFullPath(outputPath),
                StringComparison.OrdinalIgnoreCase))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.Deliver,
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest output does not match the requested PDF: {context.OutputPath}"), null);
        }

        return (execution, new AnswerDeliveryResult(
            outputPath,
            manifestPath,
            context.ReviewDirectoryPath ?? string.Empty,
            context.SnapshotId,
            subjectPack));
    }

    public async Task<(ToolchainExecutionResult Execution, LiveAnswerWorkflowResult? Result)> RunLiveWorkflowAsync(
        LiveAnswerWorkflowRequest request,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null)
    {
        var workspace = GetWorkspaceInfo();
        var sourcePath = AnswerArtifactPathResolver.ResolveUserPath(
            request.SourcePdfPath,
            workspace.RepositoryRoot);
        var outputPath = AnswerArtifactPathResolver.ResolveUserPath(
            request.OutputDirectory,
            workspace.RepositoryRoot);
        var referencePath = string.IsNullOrWhiteSpace(request.ReferencePdfPath)
            ? null
            : AnswerArtifactPathResolver.ResolveUserPath(request.ReferencePdfPath, workspace.RepositoryRoot);
        var scriptPath = Path.Combine(workspace.RepositoryRoot, "scripts", "run-live-answer-workflow.ps1");
        var manifestPath = Path.Combine(
            workspace.RepositoryRoot,
            "prompts",
            request.SubjectPack,
            "manifest.json");
        var startedAt = DateTimeOffset.Now;

        if (!File.Exists(sourcePath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Source exam PDF not found: {sourcePath}"), null);
        }
        if (!File.Exists(manifestPath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Subject pack manifest not found: {manifestPath}"), null);
        }
        try
        {
            using var manifestDocument = JsonDocument.Parse(File.ReadAllText(manifestPath));
            if (manifestDocument.RootElement.GetProperty("workflow").GetProperty("liveAnswers").GetBoolean() != true)
            {
                return (ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.LiveWorkflow,
                    scriptPath,
                    -1,
                    startedAt,
                    DateTimeOffset.Now,
                    $"Subject pack '{request.SubjectPack}' is not enabled for live answer workflows."), null);
            }
        }
        catch (Exception ex) when (ex is JsonException
            or InvalidOperationException
            or KeyNotFoundException
            or FormatException)
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Subject pack workflow contract is invalid: {ex.Message}"), null);
        }
        if (referencePath is not null && !File.Exists(referencePath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Reference PDF not found: {referencePath}"), null);
        }
        if (!File.Exists(scriptPath))
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Live workflow script not found: {scriptPath}"), null);
        }

        var arguments = new List<string>
        {
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-SourcePdf",
            sourcePath,
            "-OutputDirectory",
            outputPath,
            "-SubjectPack",
            request.SubjectPack,
            "-Profile",
            request.Profile
        };
        if (referencePath is not null)
        {
            arguments.Add("-ReferencePdf");
            arguments.Add(referencePath);
        }
        if (request.SkipVisualAudit)
        {
            arguments.Add("-SkipVisualAudit");
        }
        if (request.AllowCloudEgress)
        {
            arguments.Add("-AllowCloudEgress");
        }
        if (request.KeepReview)
        {
            arguments.Add("-KeepReview");
        }
        if (request.UseGatewayProxy)
        {
            arguments.Add("-UseGatewayProxy");
        }
        string powershellExecutable;
        try
        {
            powershellExecutable = ResolvePowerShellExecutable(workspace.RepositoryRoot);
        }
        catch (InvalidOperationException ex)
        {
            return (ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                ex.Message), null);
        }

        var process = await _processRunner.RunAsync(
            powershellExecutable,
            arguments,
            workspace.RepositoryRoot,
            cancellationToken,
            LiveWorkflowTimeout,
            progress).ConfigureAwait(false);
        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(process.StandardOutput, process.StandardError);
        var execution = process.ExitCode == 0
            ? ToolchainExecutionResult.Success(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                startedAt,
                finishedAt,
                output)
            : ToolchainExecutionResult.Failure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                process.ExitCode,
                startedAt,
                finishedAt,
                output);
        if (!execution.Succeeded)
        {
            return (execution, null);
        }

        var baseName = Path.GetFileNameWithoutExtension(sourcePath);
        var receiptPath = Path.Combine(outputPath, $"{baseName}.workflow-run.json");
        if (!File.Exists(receiptPath))
        {
            return (ArtifactFailure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                startedAt,
                finishedAt,
                output,
                $"Workflow exited successfully but its receipt was not created: {receiptPath}"), null);
        }

        try
        {
            var receipt = await ReadLiveWorkflowReceiptAsync(
                receiptPath,
                outputPath,
                workspace.RepositoryRoot,
                cancellationToken,
                baseName,
                startedAt,
                finishedAt).ConfigureAwait(false);
            return (execution, receipt);
        }
        catch (Exception ex) when (ex is IOException
            or UnauthorizedAccessException
            or JsonException
            or FormatException
            or InvalidOperationException
            or KeyNotFoundException)
        {
            return (ArtifactFailure(
                ToolchainScriptKind.LiveWorkflow,
                scriptPath,
                startedAt,
                finishedAt,
                output,
                $"Workflow receipt is invalid: {ex.Message}"), null);
        }
    }

    private async Task<ToolchainExecutionResult> RunScriptAsync(
        ToolchainScriptKind kind,
        string scriptPath,
        string repositoryRoot,
        CancellationToken cancellationToken,
        IReadOnlyList<string>? scriptArguments = null,
        Action<string>? progress = null)
    {
        var startedAt = DateTimeOffset.Now;
        if (!File.Exists(scriptPath))
        {
            return ToolchainExecutionResult.Failure(kind, scriptPath, -1, startedAt, DateTimeOffset.Now,
                $"Script not found: {scriptPath}");
        }

        var arguments = new List<string>
        {
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath
        };
        if (scriptArguments is not null)
        {
            arguments.AddRange(scriptArguments);
        }

        // Source check/bootstrap intentionally retain the developer prerequisite.
        // Packaged source tooling uses the bundled pwsh only when it is invoked
        // through migration/release surfaces; ordinary WPF check uses health.
        var process = await _processRunner.RunAsync(
            "pwsh",
            arguments,
            repositoryRoot,
            cancellationToken,
            kind switch
            {
                ToolchainScriptKind.Bootstrap => BootstrapTimeout,
                ToolchainScriptKind.Check => CheckTimeout,
                _ => DeliverTimeout
            },
            progress).ConfigureAwait(false);
        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(process.StandardOutput, process.StandardError);
        return process.ExitCode == 0
            ? ToolchainExecutionResult.Success(kind, scriptPath, startedAt, finishedAt, output)
            : ToolchainExecutionResult.Failure(kind, scriptPath, process.ExitCode, startedAt, finishedAt, output);
    }

    private static bool IsPackagedRuntime(string workspaceRoot) =>
        File.Exists(Path.Combine(workspaceRoot, "runtime-manifest.json"));

    private static string? ResolveNodeExecutable(string workspaceRoot)
    {
        var bundledNode = Path.Combine(workspaceRoot, "runtime", "node", "node.exe");
        return IsPackagedRuntime(workspaceRoot)
            ? File.Exists(bundledNode) ? bundledNode : null
            : "node";
    }

    private static string ResolvePowerShellExecutable(string workspaceRoot)
    {
        if (!IsPackagedRuntime(workspaceRoot))
        {
            return "pwsh";
        }
        var bundledPowerShell = Path.Combine(
            workspaceRoot,
            "runtime",
            "pwsh",
            OperatingSystem.IsWindows() ? "pwsh.exe" : "pwsh");
        if (!File.Exists(bundledPowerShell))
        {
            throw new InvalidOperationException("安装版 runtime 缺少 bundled PowerShell：请修复或重新安装运行时。");
        }
        return bundledPowerShell;
    }

    private static ManifestContext ReadManifestContext(string manifestPath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        var review = root.GetProperty("review");
        var status = root.GetProperty("status");
        // Manifest paths may be relative to the manifest's own directory
        // (2026-08-27 portability contract); the process CWD must not matter.
        var manifestDirectory = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        return new ManifestContext(
            root.GetProperty("generatedAt").GetDateTimeOffset(),
            root.GetProperty("subjectPack").GetString()
                ?? throw new InvalidOperationException("Manifest subjectPack is empty."),
            ResolveManifestEntryPath(manifestDirectory, root.GetProperty("input").GetString()
                ?? throw new InvalidOperationException("Manifest input is empty.")),
            ResolveManifestEntryPath(manifestDirectory, root.GetProperty("output").GetString()
                ?? throw new InvalidOperationException("Manifest output is empty.")),
            root.GetProperty("snapshotId").GetString(),
            root.GetProperty("profile").GetString()
                ?? throw new InvalidOperationException("Manifest profile is empty."),
            ResolveManifestEntryPath(manifestDirectory, review.GetProperty("outputDir").GetString()
                ?? throw new InvalidOperationException("Manifest review.outputDir is empty.")),
            status.GetProperty("deliveryComplete").GetBoolean());
    }

    private static string ResolveManifestEntryPath(string manifestDirectory, string value) =>
        Path.IsPathFullyQualified(value)
            ? Path.GetFullPath(value)
            : Path.GetFullPath(Path.Combine(manifestDirectory, value));

    private static string BuildOutput(string standardOutput, string standardError)
    {
        return string.Join(Environment.NewLine, new[] { standardOutput, standardError }
            .Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private async Task<LiveAnswerWorkflowResult> ReadLiveWorkflowReceiptAsync(
        string receiptPath,
        string outputDirectory,
        string repositoryRoot,
        CancellationToken cancellationToken,
        string baseName,
        DateTimeOffset startedAt,
        DateTimeOffset finishedAt)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(receiptPath));
        var root = document.RootElement;
        if (!File.Exists(Path.Combine(repositoryRoot, "tools", "rule-compiler", "validate-workflow-receipt.mjs")))
        {
            throw new InvalidDataException("Workflow receipt validator is missing from the packaged toolchain.");
        }
        var receiptValidation = await _processRunner.RunAsync(
            ResolveNodeExecutable(repositoryRoot)
                ?? throw new InvalidOperationException("Bundled Node.js is missing; repair the runtime before validating a workflow."),
            [
                Path.Combine(repositoryRoot, "tools", "rule-compiler", "validate-workflow-receipt.mjs"),
                "--receipt",
                receiptPath
            ],
            repositoryRoot,
            cancellationToken,
            TimeSpan.FromMinutes(2)).ConfigureAwait(false);
        if (receiptValidation.ExitCode != 0)
        {
            throw new InvalidDataException(
                BuildOutput(receiptValidation.StandardOutput, receiptValidation.StandardError));
        }
        if (!root.GetProperty("kind").GetString()!.Equals(
                "live-answer-workflow-run",
                StringComparison.Ordinal)
            || !root.GetProperty("status").GetString()!.Equals("succeeded", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Workflow receipt does not record a succeeded live-answer-workflow-run.");
        }
        var deliveredAt = root.GetProperty("finishedAt").GetDateTimeOffset();
        if (deliveredAt < startedAt.AddSeconds(-2) || deliveredAt > finishedAt.AddSeconds(5))
        {
            throw new InvalidDataException("Workflow receipt does not belong to the current application run.");
        }
        var delivery = root.GetProperty("phases").GetProperty("delivery");
        if (delivery.GetProperty("status").GetString() != "completed")
        {
            throw new InvalidDataException("Workflow receipt has no completed delivery phase.");
        }
        var outputPdfPath = delivery.GetProperty("artifactPath").GetString()
            ?? throw new InvalidDataException("Workflow receipt delivery artifact is empty.");
        var manifestPath = AnswerArtifactPathResolver.ResolveDeliveryManifestPath(outputPdfPath);
        if (!File.Exists(outputPdfPath) || !File.Exists(manifestPath))
        {
            throw new InvalidDataException("Workflow delivery or its manifest is missing.");
        }
        var manifest = ReadManifestContext(manifestPath);
        if (manifest.GeneratedAt < startedAt.AddSeconds(-2)
            || manifest.GeneratedAt > finishedAt.AddSeconds(5)
            || !string.Equals(
                Path.GetFullPath(manifest.OutputPath),
                Path.GetFullPath(outputPdfPath),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Workflow delivery manifest is incomplete or does not match its PDF.");
        }
        return new LiveAnswerWorkflowResult(
            receiptPath,
            Path.Combine(outputDirectory, $"{baseName}参考答案.md"),
            outputPdfPath,
            manifestPath,
            manifest.ReviewDirectoryPath,
            manifest.SnapshotId);
    }

    private static ToolchainExecutionResult ArtifactFailure(
        ToolchainScriptKind kind,
        string toolPath,
        DateTimeOffset startedAt,
        DateTimeOffset finishedAt,
        string processOutput,
        string message)
    {
        return ToolchainExecutionResult.Failure(
            kind,
            toolPath,
            -2,
            startedAt,
            finishedAt,
            BuildOutput(processOutput, message));
    }

    private sealed record ManifestContext(
        DateTimeOffset GeneratedAt,
        string SubjectPack,
        string InputPath,
        string OutputPath,
        string? SnapshotId,
        string Profile,
        string? ReviewDirectoryPath,
        bool DeliveryComplete);
}
