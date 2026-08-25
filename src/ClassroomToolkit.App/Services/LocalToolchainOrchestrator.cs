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
        var subjectPacks = WorkspaceSubjectPackLocator.FindSubjectPacks(repositoryRoot);

        return new ToolchainWorkspaceInfo(
            repositoryRoot,
            Path.Combine(scriptsDirectory, "bootstrap.ps1"),
            Path.Combine(scriptsDirectory, "check-toolchain.ps1"),
            File.Exists(Path.Combine(scriptsDirectory, "bootstrap.ps1")),
            File.Exists(Path.Combine(scriptsDirectory, "check-toolchain.ps1")),
            subjectPacks.FirstOrDefault(pack => pack.AssetId == "junior-physics-answer")?.AssetId
                ?? subjectPacks.FirstOrDefault()?.AssetId,
            subjectPacks.Select(pack => pack.AssetId).ToArray());
    }

    public WorkspaceHealthReport GetWorkspaceHealthReport(string? subjectPack = null)
    {
        var workspace = GetWorkspaceInfo();
        return new WorkspaceHealthReportReader(workspace.RepositoryRoot).Read(subjectPack);
    }

    public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
    {
        var workspace = GetWorkspaceInfo();
        return RunScriptAsync(
            ToolchainScriptKind.Bootstrap,
            workspace.BootstrapScriptPath,
            workspace.RepositoryRoot,
            cancellationToken);
    }

    public Task<ToolchainExecutionResult> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default)
    {
        var workspace = GetWorkspaceInfo();
        return RunScriptAsync(
            ToolchainScriptKind.Check,
            workspace.CheckScriptPath,
            workspace.RepositoryRoot,
            cancellationToken,
            string.IsNullOrWhiteSpace(subjectPack)
                ? []
                : ["-Mode", "Core", "-SubjectPack", subjectPack]);
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
            "node",
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
            answerPath,
            outputPath,
            manifestPath,
            context.ReviewDirectoryPath ?? string.Empty,
            context.SnapshotId,
            subjectPack,
            context.Profile ?? request.Profile,
            context.SnapshotPath ?? string.Empty,
            context.SnapshotVersion));
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

    private static ManifestContext ReadManifestContext(string manifestPath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        var snapshot = root.GetProperty("snapshot");
        var review = root.GetProperty("review");
        var status = root.GetProperty("status");
        return new ManifestContext(
            root.GetProperty("generatedAt").GetDateTimeOffset(),
            root.GetProperty("subjectPack").GetString()
                ?? throw new InvalidOperationException("Manifest subjectPack is empty."),
            root.GetProperty("input").GetString()
                ?? throw new InvalidOperationException("Manifest input is empty."),
            root.GetProperty("output").GetString()
                ?? throw new InvalidOperationException("Manifest output is empty."),
            root.GetProperty("snapshotId").GetString(),
            root.GetProperty("snapshotPath").GetString(),
            snapshot.GetProperty("version").GetString(),
            root.GetProperty("profile").GetString()
                ?? throw new InvalidOperationException("Manifest profile is empty."),
            review.GetProperty("outputDir").GetString(),
            status.GetProperty("deliveryComplete").GetBoolean());
    }

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
        string? SnapshotPath,
        string? SnapshotVersion,
        string Profile,
        string? ReviewDirectoryPath,
        bool DeliveryComplete);
}
