using System.Text.Json;
using System.IO;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.App.Services;

public sealed class LocalToolchainOrchestrator : IToolchainOrchestrator
{
    // Generous hang guards only: bootstrap installs SDKs over slow networks, Full
    // checks run three-subject evals, and deliver drives a headless browser.
    private static readonly TimeSpan BootstrapTimeout = TimeSpan.FromMinutes(45);
    private static readonly TimeSpan CheckTimeout = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan DeliverTimeout = TimeSpan.FromMinutes(30);
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
        var packagedRuntime = IsPackagedRuntime(repositoryRoot);
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
            packagedRuntime || File.Exists(Path.Combine(scriptsDirectory, "bootstrap.ps1")),
            packagedRuntime || File.Exists(Path.Combine(scriptsDirectory, "check-toolchain.ps1")),
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
                ResolveNodeExecutable(workspace.RepositoryRoot),
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
        return new WorkspaceHealthReport(
            ReadOptionalString(root, "primarySubjectPack"),
            ReadStringArray(root, "subjectPacks"),
            ReadOptionalString(root, "latestProductionSpecVersion"),
            ReadOptionalString(root, "assetVersion"),
            ReadBool(root, "snapshotExists"),
            root.TryGetProperty("snapshotPath", out var snapshotPath) && snapshotPath.ValueKind == JsonValueKind.String
                ? snapshotPath.GetString()!
                : string.Empty,
            ReadBool(root, "evalOk"),
            root.TryGetProperty("evalCaseCount", out var caseCount) && caseCount.ValueKind == JsonValueKind.Number
                ? caseCount.GetInt32()
                : 0,
            root.TryGetProperty("summary", out var summary) && summary.ValueKind == JsonValueKind.String
                ? summary.GetString()!
                : string.Empty,
            ReadStringArray(root, "issues"));
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
            [issue]);
    }

    private static string? ReadOptionalString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.String
            ? element.GetString()
            : null;

    private static bool ReadBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.True;

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.Array
            ? element.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!)
                .ToArray()
            : [];

    public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
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
            cancellationToken);
    }

    public async Task<ToolchainExecutionResult> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default)
    {
        var workspace = GetWorkspaceInfo();
        if (IsPackagedRuntime(workspace.RepositoryRoot))
        {
            var startedAt = DateTimeOffset.Now;
            var report = await GetWorkspaceHealthReportAsync(subjectPack, cancellationToken).ConfigureAwait(false);
            var finishedAt = DateTimeOffset.Now;
            return report.IsHealthy
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
        }

        return await RunScriptAsync(
            ToolchainScriptKind.Check,
            workspace.CheckScriptPath,
            workspace.RepositoryRoot,
            cancellationToken,
            string.IsNullOrWhiteSpace(subjectPack)
                ? []
                : ["-Mode", "Core", "-SubjectPack", subjectPack]).ConfigureAwait(false);
    }

    public async Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default)
    {
        var workspace = GetWorkspaceInfo();
        var answerPath = Path.GetFullPath(request.AnswerMarkdownPath);
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

        var outputPath = AnswerArtifactPathResolver.ResolveOutputPdfPath(answerPath, request.OutputPdfPath);
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

        var process = await _processRunner.RunAsync(
            ResolveNodeExecutable(workspace.RepositoryRoot),
            arguments,
            workspace.RepositoryRoot,
            cancellationToken,
            DeliverTimeout);
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
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Renderer exited successfully but the PDF was not created: {outputPath}"), null);
        }

        if (!File.Exists(manifestPath))
        {
            return (ArtifactFailure(
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
                toolPath,
                startedAt,
                finishedAt,
                output,
                $"Delivery manifest was not generated by this run: {context.GeneratedAt:O}"), null);
        }

        if (!context.DeliveryComplete)
        {
            return (ArtifactFailure(
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

    private async Task<ToolchainExecutionResult> RunScriptAsync(
        ToolchainScriptKind kind,
        string scriptPath,
        string repositoryRoot,
        CancellationToken cancellationToken,
        IReadOnlyList<string>? scriptArguments = null)
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
            });
        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(process.StandardOutput, process.StandardError);
        return process.ExitCode == 0
            ? ToolchainExecutionResult.Success(kind, scriptPath, startedAt, finishedAt, output)
            : ToolchainExecutionResult.Failure(kind, scriptPath, process.ExitCode, startedAt, finishedAt, output);
    }

    private static bool IsPackagedRuntime(string workspaceRoot) =>
        File.Exists(Path.Combine(workspaceRoot, "runtime-manifest.json"));

    private static string ResolveNodeExecutable(string workspaceRoot)
    {
        var bundledNode = Path.Combine(workspaceRoot, "runtime", "node", "node.exe");
        return File.Exists(bundledNode) ? bundledNode : "node";
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

    private static ToolchainExecutionResult ArtifactFailure(
        string toolPath,
        DateTimeOffset startedAt,
        DateTimeOffset finishedAt,
        string processOutput,
        string message)
    {
        return ToolchainExecutionResult.Failure(
            ToolchainScriptKind.Deliver,
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
