using System.Text.Json;
using System.Text;
using System.Security.Cryptography;
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

    public async Task<VisualDecisionAttachmentResult> AttachVisualDecisionAsync(
        VisualDecisionAttachmentRequest request,
        CancellationToken cancellationToken = default)
    {
        var repositoryRoot = GetWorkspaceInfo().RepositoryRoot;
        var toolPath = Path.Combine(repositoryRoot, "tools", "visual-evidence", "attach-decision.mjs");
        var manifestPath = Path.GetFullPath(request.DeliveryManifestPath);
        var decisionPath = Path.GetFullPath(request.DecisionRecordPath);
        var startedAt = DateTimeOffset.Now;

        var validationError = ValidateJsonInput(manifestPath, "Delivery manifest")
            ?? ValidateJsonInput(decisionPath, "DecisionRecord");
        if (validationError is not null)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachVisualDecision,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                validationError);
            return new VisualDecisionAttachmentResult(failed, null);
        }

        var processResult = await _processRunner.RunAsync(
            "npm",
            [
                "--prefix",
                Path.Combine(repositoryRoot, "tools", "visual-evidence"),
                "run",
                "attach:decision",
                "--",
                "--manifest",
                manifestPath,
                "--decision",
                decisionPath
            ],
            repositoryRoot,
            cancellationToken);

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        var execution = processResult.ExitCode == 0
            ? ToolchainExecutionResult.Success(
                ToolchainScriptKind.AttachVisualDecision,
                toolPath,
                startedAt,
                finishedAt,
                output)
            : ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachVisualDecision,
                toolPath,
                processResult.ExitCode,
                startedAt,
                finishedAt,
                output);

        if (!execution.Succeeded)
        {
            return new VisualDecisionAttachmentResult(execution, null);
        }

        try
        {
            var delivery = ReadDeliveryResult(manifestPath);
            var projection = ReadDecisionProjection(decisionPath);
            var postconditionError = ValidateAttachmentPostcondition(delivery, decisionPath, projection);
            if (postconditionError is null)
            {
                return new VisualDecisionAttachmentResult(execution, delivery);
            }

            var failedOutput = string.IsNullOrWhiteSpace(output)
                ? postconditionError
                : $"{output}{Environment.NewLine}{Environment.NewLine}[postcondition]{Environment.NewLine}{postconditionError}";
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachVisualDecision,
                toolPath,
                -2,
                startedAt,
                finishedAt,
                failedOutput);
            return new VisualDecisionAttachmentResult(failed, null);
        }
        catch (Exception ex)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachVisualDecision,
                toolPath,
                -2,
                startedAt,
                finishedAt,
                $"Attachment postcondition validation failed: {ex.Message}");
            return new VisualDecisionAttachmentResult(failed, null);
        }
    }

    public async Task<DeliveryDecisionAggregateAttachmentVerificationResult> VerifyDeliveryDecisionAggregateAttachmentAsync(
        DeliveryDecisionAggregateAttachmentVerificationRequest request,
        CancellationToken cancellationToken = default)
    {
        var repositoryRoot = GetWorkspaceInfo().RepositoryRoot;
        var toolPath = Path.Combine(
            repositoryRoot,
            "tools",
            "visual-evidence",
            "verify-delivery-decision-aggregate-attachment.mjs");
        var startedAt = DateTimeOffset.Now;
        string manifestPath;
        try
        {
            manifestPath = Path.GetFullPath(request.DeliveryManifestPath);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Delivery manifest path is invalid: {ex.Message}");
            return new DeliveryDecisionAggregateAttachmentVerificationResult(failed, null);
        }

        var validationError = ValidateJsonInput(manifestPath, "Delivery manifest");
        if (validationError is not null)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                validationError);
            return new DeliveryDecisionAggregateAttachmentVerificationResult(failed, null);
        }

        ProcessRunResult processResult;
        try
        {
            processResult = await _processRunner.RunAsync(
                "node",
                [
                    toolPath,
                    "--manifest",
                    manifestPath
                ],
                repositoryRoot,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                -3,
                startedAt,
                DateTimeOffset.Now,
                $"Aggregate attachment verifier process failed: {ex.Message}");
            return new DeliveryDecisionAggregateAttachmentVerificationResult(failed, null);
        }

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        if (processResult.ExitCode != 0)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                processResult.ExitCode,
                startedAt,
                finishedAt,
                output);
            return new DeliveryDecisionAggregateAttachmentVerificationResult(failed, null);
        }

        try
        {
            var verification = ParseAggregateAttachmentVerification(
                processResult.StandardOutput,
                manifestPath);
            var manifestBytes = File.ReadAllBytes(manifestPath);
            var manifestSha256 = Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant();
            if (!string.Equals(
                manifestSha256,
                verification.ManifestResultSha256,
                StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    "Delivery manifest bytes changed after source-aware verification.");
            }

            var delivery = ReadDeliveryResult(
                manifestBytes,
                manifestPath,
                aggregateAttachmentVerified: true);
            if (delivery is null
                || delivery.VisualReviewPassed != true
                || !delivery.Trusted)
            {
                throw new InvalidDataException(
                    "Verified delivery manifest could not be projected as trusted.");
            }

            var succeeded = ToolchainExecutionResult.Success(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                startedAt,
                finishedAt,
                output);
            return new DeliveryDecisionAggregateAttachmentVerificationResult(
                succeeded,
                verification,
                delivery);
        }
        catch (Exception ex)
        {
            var parseError = $"Aggregate attachment verification output was rejected: {ex.Message}";
            var failedOutput = string.IsNullOrWhiteSpace(output)
                ? parseError
                : $"{output}{Environment.NewLine}{Environment.NewLine}[postcondition]{Environment.NewLine}{parseError}";
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.VerifyDeliveryDecisionAggregateAttachment,
                toolPath,
                -2,
                startedAt,
                finishedAt,
                failedOutput);
            return new DeliveryDecisionAggregateAttachmentVerificationResult(failed, null);
        }
    }

    public async Task<DeliveryDecisionAggregateAttachmentResult> AttachDeliveryDecisionAggregateAsync(
        DeliveryDecisionAggregateAttachmentRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var repositoryRoot = GetWorkspaceInfo().RepositoryRoot;
        var toolPath = Path.Combine(
            repositoryRoot,
            "tools",
            "visual-evidence",
            "attach-delivery-decision-aggregate.mjs");
        var startedAt = DateTimeOffset.Now;
        string manifestPath;
        string aggregatePath;
        try
        {
            manifestPath = Path.GetFullPath(request.DeliveryManifestPath);
            aggregatePath = Path.GetFullPath(request.AggregatePath);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                $"Aggregate attachment path is invalid: {ex.Message}");
            return new DeliveryDecisionAggregateAttachmentResult(failed, null);
        }

        var validationError = ValidateJsonInput(manifestPath, "Delivery manifest")
            ?? ValidateJsonInput(aggregatePath, "DeliveryDecisionAggregate");
        if (validationError is not null)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                validationError);
            return new DeliveryDecisionAggregateAttachmentResult(failed, null);
        }

        ProcessRunResult processResult;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            processResult = await _processRunner.RunAsync(
                "node",
                [
                    toolPath,
                    "--manifest",
                    manifestPath,
                    "--aggregate",
                    aggregatePath
                ],
                repositoryRoot,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                toolPath,
                -3,
                startedAt,
                DateTimeOffset.Now,
                $"Aggregate attachment process failed: {ex.Message}");
            return new DeliveryDecisionAggregateAttachmentResult(failed, null);
        }

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        var execution = processResult.ExitCode == 0
            ? ToolchainExecutionResult.Success(
                ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                toolPath,
                startedAt,
                finishedAt,
                output)
            : ToolchainExecutionResult.Failure(
                ToolchainScriptKind.AttachDeliveryDecisionAggregate,
                toolPath,
                processResult.ExitCode,
                startedAt,
                finishedAt,
                output);
        if (!execution.Succeeded)
        {
            return new DeliveryDecisionAggregateAttachmentResult(execution, null);
        }

        cancellationToken.ThrowIfCancellationRequested();
        var verification = await VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(manifestPath),
            cancellationToken);
        return new DeliveryDecisionAggregateAttachmentResult(execution, verification);
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

    private static string? ValidateJsonInput(string filePath, string label)
    {
        if (!string.Equals(Path.GetExtension(filePath), ".json", StringComparison.OrdinalIgnoreCase))
        {
            return $"{label} must be a JSON file: {filePath}";
        }

        return File.Exists(filePath) ? null : $"{label} not found: {filePath}";
    }

    private static DecisionProjection ReadDecisionProjection(string decisionPath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(decisionPath));
        var root = document.RootElement;
        if (!root.TryGetProperty("statusProjection", out var projection)
            || projection.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("DecisionRecord.statusProjection is missing.");
        }

        return new DecisionProjection(
            ReadNullableBoolean(projection, "visualReviewPassed"),
            projection.TryGetProperty("trusted", out var trustedElement)
                && trustedElement.ValueKind == JsonValueKind.True);
    }

    private static string? ValidateAttachmentPostcondition(
        AnswerDeliveryResult? delivery,
        string decisionPath,
        DecisionProjection projection)
    {
        if (delivery is null)
        {
            return "Updated delivery manifest could not be projected.";
        }

        if (delivery.VisualDecisionPath is null
            || !string.Equals(
                Path.GetFullPath(delivery.VisualDecisionPath),
                Path.GetFullPath(decisionPath),
                StringComparison.OrdinalIgnoreCase))
        {
            return "Updated delivery manifest does not reference the requested DecisionRecord.";
        }

        if (delivery.VisualReviewPassed != projection.VisualReviewPassed
            || delivery.Trusted != projection.Trusted)
        {
            return "Updated delivery manifest status does not match DecisionRecord.statusProjection.";
        }

        return null;
    }

    private static DeliveryDecisionAggregateAttachmentVerification ParseAggregateAttachmentVerification(
        string standardOutput,
        string requestedManifestPath)
    {
        using var document = JsonDocument.Parse(standardOutput);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("Verifier output must be one JSON object.");
        }

        ValidateAggregateAttachmentVerificationProperties(root);
        var kind = ReadRequiredString(root, "kind");
        if (!string.Equals(kind, "delivery-decision-aggregate-attachment", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Verifier output kind is invalid.");
        }

        var manifestPath = ReadRequiredAbsolutePath(root, "manifestPath");
        if (!string.Equals(
            Path.GetFullPath(manifestPath),
            Path.GetFullPath(requestedManifestPath),
            StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Verifier output does not reference the requested delivery manifest.");
        }

        var aggregatePath = ReadRequiredAbsolutePath(root, "aggregatePath");
        var preimageBackupPath = ReadRequiredAbsolutePath(root, "preimageBackupPath");
        var receiptPath = ReadRequiredAbsolutePath(root, "receiptPath");
        var attachmentId = ReadRequiredString(root, "attachmentId");
        var manifestPreimageSha256 = ReadRequiredSha256(root, "manifestPreimageSha256");
        var manifestResultSha256 = ReadRequiredSha256(root, "manifestResultSha256");
        var visualReviewPassed = ReadRequiredTrue(root, "visualReviewPassed");
        var trusted = ReadRequiredTrue(root, "trusted");

        return new DeliveryDecisionAggregateAttachmentVerification(
            manifestPath,
            aggregatePath,
            preimageBackupPath,
            receiptPath,
            attachmentId,
            manifestPreimageSha256,
            manifestResultSha256,
            visualReviewPassed,
            trusted);
    }

    private static void ValidateAggregateAttachmentVerificationProperties(JsonElement root)
    {
        string[] expectedPropertyNames =
        [
            "kind",
            "manifestPath",
            "aggregatePath",
            "preimageBackupPath",
            "receiptPath",
            "attachmentId",
            "manifestPreimageSha256",
            "manifestResultSha256",
            "visualReviewPassed",
            "trusted"
        ];
        var expected = new HashSet<string>(expectedPropertyNames, StringComparer.Ordinal);
        var observed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!expected.Contains(property.Name))
            {
                throw new InvalidDataException($"Verifier output contains unknown property {property.Name}.");
            }

            if (!observed.Add(property.Name))
            {
                throw new InvalidDataException($"Verifier output contains duplicate property {property.Name}.");
            }
        }
    }

    private static string ReadRequiredString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var valueElement)
            || valueElement.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(valueElement.GetString()))
        {
            throw new InvalidDataException($"Verifier output {propertyName} is missing or invalid.");
        }

        return valueElement.GetString()!;
    }

    private static string ReadRequiredAbsolutePath(JsonElement element, string propertyName)
    {
        var value = ReadRequiredString(element, propertyName);
        if (!Path.IsPathFullyQualified(value))
        {
            throw new InvalidDataException($"Verifier output {propertyName} must be an absolute path.");
        }

        return value;
    }

    private static string ReadRequiredSha256(JsonElement element, string propertyName)
    {
        var value = ReadRequiredString(element, propertyName);
        if (value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidDataException($"Verifier output {propertyName} must be a SHA-256 hex digest.");
        }

        return value.ToLowerInvariant();
    }

    private static bool ReadRequiredTrue(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var valueElement)
            || valueElement.ValueKind != JsonValueKind.True)
        {
            throw new InvalidDataException($"Verifier output {propertyName} must be true.");
        }

        return true;
    }

    private static AnswerDeliveryResult? ReadDeliveryResult(string deliveryManifestPath)
    {
        if (!File.Exists(deliveryManifestPath))
        {
            return null;
        }

        return ReadDeliveryResult(
            File.ReadAllBytes(deliveryManifestPath),
            deliveryManifestPath,
            aggregateAttachmentVerified: false);
    }

    private static AnswerDeliveryResult? ReadDeliveryResult(
        ReadOnlyMemory<byte> manifestBytes,
        string deliveryManifestPath,
        bool aggregateAttachmentVerified)
    {
        using var document = JsonDocument.Parse(manifestBytes);
        var root = document.RootElement;
        var deliveryContext = ReadDeliveryContext(
            root,
            deliveryManifestPath,
            aggregateAttachmentVerified);
        var inputPath = ResolveManifestPath(ReadOptionalString(root, "input"), deliveryManifestPath);
        var outputPath = ResolveManifestPath(ReadOptionalString(root, "output"), deliveryManifestPath);
        var subjectPack = ReadOptionalString(root, "subjectPack");
        var profile = deliveryContext.Profile;
        var reviewDirectoryPath = root.TryGetProperty("review", out var reviewElement)
            && reviewElement.ValueKind == JsonValueKind.Object
                ? ResolveManifestPath(ReadOptionalString(reviewElement, "outputDir"), deliveryManifestPath)
                : null;

        if (inputPath is null
            || outputPath is null
            || subjectPack is null
            || profile is null
            || reviewDirectoryPath is null)
        {
            return null;
        }

        return new AnswerDeliveryResult(
            inputPath,
            outputPath,
            deliveryManifestPath,
            reviewDirectoryPath,
            deliveryContext.SnapshotId,
            subjectPack,
            profile,
            deliveryContext.SnapshotPath ?? string.Empty,
            deliveryContext.SnapshotVersion)
        {
            ReviewLifecycleState = deliveryContext.ReviewLifecycleState,
            VisualDecisionPath = deliveryContext.VisualDecisionPath,
            VisualReviewPassed = deliveryContext.VisualReviewPassed,
            Trusted = deliveryContext.Trusted
        };
    }

    private static DeliveryContext ReadDeliveryContext(string deliveryManifestPath)
    {
        if (!File.Exists(deliveryManifestPath))
        {
            return DeliveryContext.Empty;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(deliveryManifestPath));
        return ReadDeliveryContext(document.RootElement, deliveryManifestPath);
    }

    private static DeliveryContext ReadDeliveryContext(
        JsonElement root,
        string deliveryManifestPath,
        bool aggregateAttachmentVerified = false)
    {
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
        var aggregateAttachmentRequiresVerification = !aggregateAttachmentVerified
            && reviewExists
            && reviewElement.TryGetProperty("deliveryDecisionAggregateAttachment", out _);

        var statusExists = root.TryGetProperty("status", out var statusElement)
            && statusElement.ValueKind == JsonValueKind.Object;
        var visualReviewPassed = statusExists && !aggregateAttachmentRequiresVerification
            ? ReadNullableBoolean(statusElement, "visualReviewPassed")
            : null;
        var trusted = statusExists && !aggregateAttachmentRequiresVerification
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

        return ResolveManifestPath(pathValue, deliveryManifestPath);
    }

    private static string? ResolveManifestPath(string? pathValue, string deliveryManifestPath)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
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

    private sealed record DecisionProjection(bool? VisualReviewPassed, bool Trusted);
}
