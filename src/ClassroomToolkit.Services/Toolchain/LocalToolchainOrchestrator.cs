using System.Text.Json;
using System.Text;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.Services.Toolchain;

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
        var bootstrapScriptPath = Path.Combine(scriptsDirectory, "bootstrap.ps1");
        var checkScriptPath = Path.Combine(scriptsDirectory, "check-toolchain.ps1");
        var subjectPacks = WorkspaceSubjectPackLocator.FindSubjectPacks(repositoryRoot);
        var primarySubjectPack = subjectPacks.FirstOrDefault()?.AssetId ?? "physics-answer";

        return new ToolchainWorkspaceInfo(
            repositoryRoot,
            bootstrapScriptPath,
            checkScriptPath,
            File.Exists(bootstrapScriptPath),
            File.Exists(checkScriptPath),
            primarySubjectPack,
            subjectPacks.Select(pack => pack.AssetId).ToArray());
    }

    public WorkspaceHealthReport GetWorkspaceHealthReport()
    {
        var workspaceInfo = GetWorkspaceInfo();
        return new WorkspaceHealthReportReader(workspaceInfo.RepositoryRoot).Read();
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
        var workspaceInfo = GetWorkspaceInfo();
        var repositoryRoot = workspaceInfo.RepositoryRoot;
        var deliverScriptPath = Path.Combine(repositoryRoot, "tools", "latex-renderer", "deliver-answer.mjs");
        var answerMarkdownPath = Path.GetFullPath(request.AnswerMarkdownPath);
        var subjectPack = string.IsNullOrWhiteSpace(request.SubjectPack)
            ? workspaceInfo.PrimarySubjectPack ?? "physics-answer"
            : request.SubjectPack;

        if (!File.Exists(answerMarkdownPath))
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.Deliver,
                deliverScriptPath,
                -1,
                DateTimeOffset.Now,
                DateTimeOffset.Now,
                $"Answer Markdown not found: {answerMarkdownPath}");
            return (failed, null);
        }

        var outputPdfPath = AnswerArtifactPathResolver.ResolveOutputPdfPath(answerMarkdownPath, request.OutputPdfPath);
        var deliveryManifestPath = AnswerArtifactPathResolver.ResolveDeliveryManifestPath(outputPdfPath);
        var reviewDirectoryPath = AnswerArtifactPathResolver.ResolveReviewDirectoryPath(repositoryRoot, outputPdfPath);
        var startedAt = DateTimeOffset.Now;

        var arguments = new List<string>
        {
            "--prefix",
            Path.Combine(repositoryRoot, "tools", "latex-renderer"),
            "run",
            "deliver",
            "--",
            answerMarkdownPath,
            outputPdfPath,
            "--subject-pack",
            subjectPack,
            "--profile",
            request.Profile
        };

        if (request.KeepReviewArtifacts)
        {
            arguments.Add("--keep-review");
        }

        var processResult = await _processRunner.RunAsync(
            "npm",
            arguments,
            repositoryRoot,
            cancellationToken);

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        var execution = processResult.ExitCode == 0
            ? ToolchainExecutionResult.Success(ToolchainScriptKind.Deliver, deliverScriptPath, startedAt, finishedAt, output)
            : ToolchainExecutionResult.Failure(ToolchainScriptKind.Deliver, deliverScriptPath, processResult.ExitCode, startedAt, finishedAt, output);

        if (!execution.Succeeded)
        {
            return (execution, null);
        }

        var deliveryContext = ReadDeliveryContext(deliveryManifestPath);

        return (
            execution,
            new AnswerDeliveryResult(
                answerMarkdownPath,
                outputPdfPath,
                deliveryManifestPath,
                reviewDirectoryPath,
                deliveryContext.SnapshotId,
                subjectPack,
                deliveryContext.Profile ?? request.Profile,
                deliveryContext.SnapshotPath ?? string.Empty,
                deliveryContext.SnapshotVersion));
    }

    private async Task<ToolchainExecutionResult> RunScriptAsync(
        ToolchainScriptKind kind,
        string scriptPath,
        CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.Now;
        if (!File.Exists(scriptPath))
        {
            return ToolchainExecutionResult.Failure(
                kind,
                scriptPath,
                exitCode: -1,
                startedAt,
                DateTimeOffset.Now,
                $"Script not found: {scriptPath}");
        }

        var repositoryRoot = Path.GetDirectoryName(Path.GetDirectoryName(scriptPath)!)!;
        var result = await _processRunner.RunAsync(
            ResolvePowerShellExecutable(),
            [
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                scriptPath
            ],
            repositoryRoot,
            cancellationToken);

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(result.StandardOutput, result.StandardError);

        return result.ExitCode == 0
            ? ToolchainExecutionResult.Success(kind, scriptPath, startedAt, finishedAt, output)
            : ToolchainExecutionResult.Failure(kind, scriptPath, result.ExitCode, startedAt, finishedAt, output);
    }

    private static string ResolvePowerShellExecutable()
    {
        var systemRoot = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        var windowsPowerShell = Path.Combine(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        return File.Exists(windowsPowerShell) ? windowsPowerShell : "powershell.exe";
    }

    private static string BuildOutput(string standardOutput, string standardError)
    {
        var builder = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(standardOutput))
        {
            builder.AppendLine(standardOutput.TrimEnd());
        }

        if (!string.IsNullOrWhiteSpace(standardError))
        {
            if (builder.Length > 0)
            {
                builder.AppendLine();
            }

            builder.AppendLine("[stderr]");
            builder.AppendLine(standardError.TrimEnd());
        }

        return builder.ToString().TrimEnd();
    }

    private static (string? SnapshotId, string? Profile, string? SnapshotPath, string? SnapshotVersion) ReadDeliveryContext(string deliveryManifestPath)
    {
        if (!File.Exists(deliveryManifestPath))
        {
            return (null, null, null, null);
        }

        using var document = JsonDocument.Parse(File.ReadAllText(deliveryManifestPath));
        var root = document.RootElement;

        var profile = root.TryGetProperty("profile", out var profileElement)
            ? profileElement.GetString()
            : null;
        var snapshotPath = root.TryGetProperty("snapshotPath", out var snapshotPathElement)
            ? snapshotPathElement.GetString()
            : null;
        var snapshotVersion = root.TryGetProperty("snapshot", out var snapshotElement)
            && snapshotElement.TryGetProperty("version", out var snapshotVersionElement)
                ? snapshotVersionElement.GetString()
                : null;

        if (root.TryGetProperty("snapshot", out var snapshotIdContainer)
            && snapshotIdContainer.TryGetProperty("id", out var snapshotIdElement))
        {
            return (snapshotIdElement.GetString(), profile, snapshotPath, snapshotVersion);
        }

        if (root.TryGetProperty("snapshotId", out var fallbackSnapshotId))
        {
            return (fallbackSnapshotId.GetString(), profile, snapshotPath, snapshotVersion);
        }

        return (null, profile, snapshotPath, snapshotVersion);
    }
}
