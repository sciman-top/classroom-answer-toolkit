using System.Text.Json;
using System.IO;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.App.Services;

public sealed class LocalToolchainOrchestrator : IToolchainOrchestrator
{
    private readonly IRepositoryRootResolver _repositoryRootResolver;
    private readonly IProcessRunner _processRunner;

    public LocalToolchainOrchestrator(
        IRepositoryRootResolver repositoryRootResolver,
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

    public WorkspaceHealthReport GetWorkspaceHealthReport()
    {
        var workspace = GetWorkspaceInfo();
        return new WorkspaceHealthReportReader(workspace.RepositoryRoot).Read();
    }

    public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
    {
        return RunScriptAsync(ToolchainScriptKind.Bootstrap, GetWorkspaceInfo().BootstrapScriptPath, cancellationToken);
    }

    public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default)
    {
        return RunScriptAsync(ToolchainScriptKind.Check, GetWorkspaceInfo().CheckScriptPath, cancellationToken);
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

        var outputPath = AnswerArtifactPathResolver.ResolveOutputPdfPath(answerPath, request.OutputPdfPath);
        var subjectPack = string.IsNullOrWhiteSpace(request.SubjectPack)
            ? workspace.PrimarySubjectPack ?? "junior-physics-answer"
            : request.SubjectPack;
        var arguments = new List<string>
        {
            "--prefix", Path.Combine(workspace.RepositoryRoot, "tools", "latex-renderer"),
            "run", "deliver", "--", answerPath, outputPath,
            "--subject-pack", subjectPack,
            "--profile", request.Profile
        };
        if (request.KeepReviewArtifacts)
        {
            arguments.Add("--keep-review");
        }

        var process = await _processRunner.RunAsync("npm", arguments, workspace.RepositoryRoot, cancellationToken);
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
        var context = ReadManifestContext(manifestPath);
        return (execution, new AnswerDeliveryResult(
            answerPath,
            outputPath,
            manifestPath,
            AnswerArtifactPathResolver.ResolveReviewDirectoryPath(workspace.RepositoryRoot, outputPath),
            context.SnapshotId,
            subjectPack,
            context.Profile ?? request.Profile,
            context.SnapshotPath ?? string.Empty,
            context.SnapshotVersion)
        {
            ReviewLifecycleState = context.ReviewState
        });
    }

    private async Task<ToolchainExecutionResult> RunScriptAsync(
        ToolchainScriptKind kind,
        string scriptPath,
        CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.Now;
        if (!File.Exists(scriptPath))
        {
            return ToolchainExecutionResult.Failure(kind, scriptPath, -1, startedAt, DateTimeOffset.Now,
                $"Script not found: {scriptPath}");
        }

        var process = await _processRunner.RunAsync(
            "pwsh",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
            GetWorkspaceInfo().RepositoryRoot,
            cancellationToken);
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
        var reviewState = review.TryGetProperty("lifecycle", out var lifecycle)
            && lifecycle.TryGetProperty("state", out var state)
                ? state.GetString()
                : null;
        return new ManifestContext(
            root.GetProperty("snapshotId").GetString(),
            root.GetProperty("snapshotPath").GetString(),
            snapshot.GetProperty("version").GetString(),
            root.GetProperty("profile").GetString(),
            reviewState);
    }

    private static string BuildOutput(string standardOutput, string standardError)
    {
        return string.Join(Environment.NewLine, new[] { standardOutput, standardError }
            .Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private sealed record ManifestContext(
        string? SnapshotId,
        string? SnapshotPath,
        string? SnapshotVersion,
        string? Profile,
        string? ReviewState);
}
