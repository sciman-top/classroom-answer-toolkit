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
        var primarySubjectPack = subjectPacks.FirstOrDefault()?.AssetId ?? "junior-physics-answer";

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
            ? workspaceInfo.PrimarySubjectPack ?? "junior-physics-answer"
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
                deliveryContext.SnapshotVersion)
            {
                ReviewLifecycleState = deliveryContext.ReviewLifecycleState,
                VisualDecisionPath = deliveryContext.VisualDecisionPath,
                VisualReviewPassed = deliveryContext.VisualReviewPassed,
                Trusted = deliveryContext.Trusted
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

    private static DeliveryContext ReadDeliveryContext(string deliveryManifestPath)
    {
        if (!File.Exists(deliveryManifestPath))
        {
            return DeliveryContext.Empty;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(deliveryManifestPath));
        var root = document.RootElement;

        var profile = ReadOptionalString(root, "profile");
        var snapshotPath = ReadOptionalString(root, "snapshotPath");
        var snapshotVersion = root.TryGetProperty("snapshot", out var snapshotElement)
            && snapshotElement.ValueKind == JsonValueKind.Object
            && snapshotElement.TryGetProperty("version", out var snapshotVersionElement)
            && snapshotVersionElement.ValueKind == JsonValueKind.String
                ? snapshotVersionElement.GetString()
                : null;
        var snapshotId = root.TryGetProperty("snapshot", out var snapshotIdContainer)
            && snapshotIdContainer.ValueKind == JsonValueKind.Object
            && snapshotIdContainer.TryGetProperty("id", out var snapshotIdElement)
            && snapshotIdElement.ValueKind == JsonValueKind.String
                ? snapshotIdElement.GetString()
                : null;

        var reviewExists = root.TryGetProperty("review", out var reviewElement)
            && reviewElement.ValueKind == JsonValueKind.Object;
        var lifecycleState = reviewExists
            && reviewElement.TryGetProperty("lifecycle", out var lifecycleElement)
            && lifecycleElement.ValueKind == JsonValueKind.Object
                ? ReadOptionalString(lifecycleElement, "state")
                : null;
        var visualDecisionRef = reviewExists
            ? ReadOptionalString(reviewElement, "visualDecisionRef")
            : null;
        var visualDecisionPath = ResolveManifestRelativePath(visualDecisionRef, deliveryManifestPath);

        var statusExists = root.TryGetProperty("status", out var statusElement)
            && statusElement.ValueKind == JsonValueKind.Object;
        var visualReviewPassed = statusExists
            ? ReadNullableBoolean(statusElement, "visualReviewPassed")
            : null;
        var trusted = statusExists
            && statusElement.TryGetProperty("trusted", out var trustedElement)
            && trustedElement.ValueKind == JsonValueKind.True;

        return new DeliveryContext(
            snapshotId,
            profile,
            snapshotPath,
            snapshotVersion,
            lifecycleState,
            visualDecisionPath,
            visualReviewPassed,
            trusted);
    }

    private static string? ReadOptionalString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var valueElement)
            && valueElement.ValueKind == JsonValueKind.String
                ? valueElement.GetString()
                : null;
    }

    private static bool? ReadNullableBoolean(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var valueElement))
        {
            return null;
        }

        return valueElement.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    private static string? ResolveManifestRelativePath(string? pathValue, string deliveryManifestPath)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            return null;
        }

        if (!string.Equals(Path.GetExtension(pathValue), ".json", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (Path.IsPathFullyQualified(pathValue))
        {
            return pathValue;
        }

        var manifestDirectory = Path.GetDirectoryName(deliveryManifestPath) ?? string.Empty;
        return Path.GetFullPath(Path.Combine(manifestDirectory, pathValue));
    }

    private sealed record DeliveryContext(
        string? SnapshotId,
        string? Profile,
        string? SnapshotPath,
        string? SnapshotVersion,
        string? ReviewLifecycleState,
        string? VisualDecisionPath,
        bool? VisualReviewPassed,
        bool Trusted)
    {
        public static DeliveryContext Empty { get; } = new(
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false);
    }
}
