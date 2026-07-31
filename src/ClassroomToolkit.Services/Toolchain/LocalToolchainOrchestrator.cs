using System.Text.Json;
using System.Text;
using System.Security.Cryptography;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Generation;
using ClassroomToolkit.Domain.Review;
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

    public async Task<ProviderAnswerGenerationExecutionResult> RunProviderAnswerGenerationAsync(
        ProviderAnswerGenerationExecutionRequest request,
        CancellationToken cancellationToken = default)
    {
        var repositoryRoot = GetWorkspaceInfo().RepositoryRoot;
        var toolPath = Path.Combine(repositoryRoot, "tools", "answer-generator", "provider-generator.mjs");
        var startedAt = DateTimeOffset.Now;

        string requestPath;
        string workspaceRoot;
        string outputDirectoryPath;
        string configEnvFilePath;
        try
        {
            requestPath = Path.GetFullPath(request.RequestArtifactPath);
            workspaceRoot = Path.GetFullPath(request.WorkspaceRoot);
            outputDirectoryPath = Path.GetFullPath(request.OutputDirectoryPath);
            configEnvFilePath = Path.GetFullPath(request.ConfigEnvFilePath);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return ProviderGenerationFailure(toolPath, startedAt, $"Provider generation path is invalid: {ex.Message}");
        }

        var validationError = ValidateProviderGenerationInput(
            repositoryRoot,
            toolPath,
            requestPath,
            workspaceRoot,
            outputDirectoryPath,
            configEnvFilePath,
            request);
        if (validationError is not null)
        {
            return ProviderGenerationFailure(toolPath, startedAt, validationError);
        }

        ProcessRunResult processResult;
        try
        {
            processResult = await _processRunner.RunAsync(
                "node",
                [
                    toolPath,
                    "--request", requestPath,
                    "--workspace-root", workspaceRoot,
                    "--instruction-root", repositoryRoot,
                    "--out", outputDirectoryPath,
                    "--config-env-file", configEnvFilePath,
                    "--timeout-ms", request.TimeoutMilliseconds.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    "--max-output-tokens", request.MaxOutputTokens.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    "--allow-cloud-egress"
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
            return ProviderGenerationFailure(toolPath, startedAt, $"Provider generation process failed: {ex.Message}", -3);
        }

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        if (processResult.ExitCode != 0)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.GenerateProviderAnswer,
                toolPath,
                processResult.ExitCode,
                startedAt,
                finishedAt,
                output);
            return new ProviderAnswerGenerationExecutionResult(failed, null, null, null);
        }

        try
        {
            var answerPath = Path.Combine(outputDirectoryPath, "answer.md");
            var resultPath = Path.Combine(outputDirectoryPath, "answer-generation-result.json");
            var answerBytes = ReadBoundedFile(answerPath, "Generated answer Markdown");
            var resultBytes = ReadBoundedFile(resultPath, "AnswerGenerationResult");
            var generation = JsonSerializer.Deserialize<AnswerGenerationResult>(
                resultBytes,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("AnswerGenerationResult is empty.");
            var sourceRequestBytes = ReadBoundedFile(requestPath, "AnswerGenerationRequest");
            var sourceRequest = JsonSerializer.Deserialize<AnswerGenerationRequest>(
                sourceRequestBytes,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("AnswerGenerationRequest is empty.");
            ValidateProviderGenerationOutput(generation, sourceRequest, sourceRequestBytes, answerBytes);

            var succeeded = ToolchainExecutionResult.Success(
                ToolchainScriptKind.GenerateProviderAnswer,
                toolPath,
                startedAt,
                finishedAt,
                output);
            return new ProviderAnswerGenerationExecutionResult(succeeded, generation, answerPath, resultPath);
        }
        catch (Exception ex)
        {
            var postcondition = $"Provider generation output was rejected: {ex.Message}";
            var failedOutput = string.IsNullOrWhiteSpace(output)
                ? postcondition
                : $"{output}{Environment.NewLine}{Environment.NewLine}[postcondition]{Environment.NewLine}{postcondition}";
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.GenerateProviderAnswer,
                toolPath,
                -2,
                startedAt,
                finishedAt,
                failedOutput);
            return new ProviderAnswerGenerationExecutionResult(failed, null, null, null);
        }
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

    public async Task<ReviewQueueProjectionResult> ProjectReviewQueueAsync(
        ReviewQueueProjectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var repositoryRoot = GetWorkspaceInfo().RepositoryRoot;
        var toolPath = Path.Combine(repositoryRoot, "tools", "review-queue", "review-queue-projector.mjs");
        var startedAt = DateTimeOffset.Now;
        if (request.ArtifactPaths.Count == 0)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.ProjectReviewQueue,
                toolPath,
                -1,
                startedAt,
                DateTimeOffset.Now,
                "At least one review artifact is required.");
            return new ReviewQueueProjectionResult(failed, null);
        }

        var artifactPaths = new List<string>(request.ArtifactPaths.Count);
        foreach (var artifactPath in request.ArtifactPaths)
        {
            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(artifactPath);
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                var failed = ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.ProjectReviewQueue,
                    toolPath,
                    -1,
                    startedAt,
                    DateTimeOffset.Now,
                    $"Review artifact path is invalid: {ex.Message}");
                return new ReviewQueueProjectionResult(failed, null);
            }

            var validationError = ValidateJsonInput(fullPath, "Review artifact");
            if (validationError is not null)
            {
                var failed = ToolchainExecutionResult.Failure(
                    ToolchainScriptKind.ProjectReviewQueue,
                    toolPath,
                    -1,
                    startedAt,
                    DateTimeOffset.Now,
                    validationError);
                return new ReviewQueueProjectionResult(failed, null);
            }
            artifactPaths.Add(fullPath);
        }

        var arguments = new List<string> { toolPath };
        foreach (var artifactPath in artifactPaths)
        {
            arguments.Add("--artifact");
            arguments.Add(artifactPath);
        }

        ProcessRunResult processResult;
        try
        {
            processResult = await _processRunner.RunAsync(
                "node",
                arguments,
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
                ToolchainScriptKind.ProjectReviewQueue,
                toolPath,
                -3,
                startedAt,
                DateTimeOffset.Now,
                $"Review queue projector process failed: {ex.Message}");
            return new ReviewQueueProjectionResult(failed, null);
        }

        var finishedAt = DateTimeOffset.Now;
        var output = BuildOutput(processResult.StandardOutput, processResult.StandardError);
        if (processResult.ExitCode != 0)
        {
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.ProjectReviewQueue,
                toolPath,
                processResult.ExitCode,
                startedAt,
                finishedAt,
                output);
            return new ReviewQueueProjectionResult(failed, null);
        }

        try
        {
            var projection = ParseReviewQueueProjection(processResult.StandardOutput, artifactPaths);
            var succeeded = ToolchainExecutionResult.Success(
                ToolchainScriptKind.ProjectReviewQueue,
                toolPath,
                startedAt,
                finishedAt,
                output);
            return new ReviewQueueProjectionResult(succeeded, projection);
        }
        catch (Exception ex)
        {
            var parseError = $"Review queue projection output was rejected: {ex.Message}";
            var failedOutput = string.IsNullOrWhiteSpace(output)
                ? parseError
                : $"{output}{Environment.NewLine}{Environment.NewLine}[postcondition]{Environment.NewLine}{parseError}";
            var failed = ToolchainExecutionResult.Failure(
                ToolchainScriptKind.ProjectReviewQueue,
                toolPath,
                -2,
                startedAt,
                finishedAt,
                failedOutput);
            return new ReviewQueueProjectionResult(failed, null);
        }
    }

    private static ReviewQueueProjection ParseReviewQueueProjection(
        string standardOutput,
        IReadOnlyList<string> requestedPaths)
    {
        using var document = JsonDocument.Parse(standardOutput);
        var root = document.RootElement;
        RequireExactProperties(root, [
            "schemaVersion",
            "kind",
            "succeeded",
            "authority",
            "sourceCount",
            "counts",
            "items",
            "rejectedSources"
        ]);
        if (ReadRequiredString(root, "schemaVersion") != "1.0"
            || ReadRequiredString(root, "kind") != "review-queue-projection-result")
        {
            throw new InvalidDataException("Unexpected review queue projection contract version or kind.");
        }
        var authority = ReadRequiredString(root, "authority");
        if (authority != "local_verified_projection")
        {
            throw new InvalidDataException("Unexpected review queue projection authority.");
        }
        var succeeded = ReadRequiredBoolean(root, "succeeded");
        var sourceCount = ReadRequiredNonNegativeInteger(root, "sourceCount");
        if (sourceCount != requestedPaths.Count)
        {
            throw new InvalidDataException("Review queue projection sourceCount does not match the request.");
        }

        var countsElement = ReadRequiredObject(root, "counts");
        RequireExactProperties(countsElement, [
            "needsHumanLabel",
            "highRiskApproval",
            "truthNeedsReview"
        ]);
        var needsHumanLabelCount = ReadRequiredNonNegativeInteger(countsElement, "needsHumanLabel");
        var highRiskApprovalCount = ReadRequiredNonNegativeInteger(countsElement, "highRiskApproval");
        var truthNeedsReviewCount = ReadRequiredNonNegativeInteger(countsElement, "truthNeedsReview");
        var items = ParseReviewQueueItems(root, requestedPaths);
        var rejectedSources = ParseRejectedSources(root);
        if (succeeded && rejectedSources.Count != 0)
        {
            throw new InvalidDataException("Successful review queue projection cannot contain rejected sources.");
        }
        if (!succeeded && (items.Count != 0
            || rejectedSources.Count == 0
            || needsHumanLabelCount != 0
            || highRiskApprovalCount != 0
            || truthNeedsReviewCount != 0))
        {
            throw new InvalidDataException("Failed review queue projection must remain fail closed.");
        }
        if (items.Count(item => item.Queue == "needs_human_label") != needsHumanLabelCount
            || items.Count(item => item.Queue == "high_risk_approval") != highRiskApprovalCount
            || items.Count(item => item.Queue == "truth_needs_review") != truthNeedsReviewCount)
        {
            throw new InvalidDataException("Review queue counts do not match projected items.");
        }

        return new ReviewQueueProjection(
            succeeded,
            authority,
            sourceCount,
            needsHumanLabelCount,
            highRiskApprovalCount,
            truthNeedsReviewCount,
            items,
            rejectedSources);
    }

    private static IReadOnlyList<ReviewQueueItem> ParseReviewQueueItems(
        JsonElement root,
        IReadOnlyList<string> requestedPaths)
    {
        var array = ReadRequiredArray(root, "items");
        var requestedCanonicalPaths = requestedPaths
            .Select(path => Path.GetFullPath(path))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var projectedSourcePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var items = new List<ReviewQueueItem>();
        foreach (var element in array.EnumerateArray())
        {
            RequireExactProperties(element, [
                "queue",
                "artifactKind",
                "artifactId",
                "subjectPack",
                "sourcePath",
                "sourceSha256",
                "reason"
            ]);
            var queue = ReadRequiredString(element, "queue");
            if (queue is not ("needs_human_label" or "high_risk_approval" or "truth_needs_review"))
            {
                throw new InvalidDataException("Review queue item contains an unsupported queue.");
            }
            var artifactKind = ReadRequiredString(element, "artifactKind");
            if (artifactKind is not ("feedback-parse-result" or "decision-record" or "delivery-decision-aggregate"))
            {
                throw new InvalidDataException("Review queue item contains an unsupported artifact kind.");
            }
            var sourcePath = ReadRequiredAbsolutePath(element, "sourcePath");
            if (!requestedCanonicalPaths.Contains(sourcePath))
            {
                throw new InvalidDataException("Review queue item sourcePath was not requested.");
            }
            if (!projectedSourcePaths.Add(sourcePath))
            {
                throw new InvalidDataException("Review queue output contains duplicate sourcePath items.");
            }
            var sourceSha256 = ReadRequiredSha256(element, "sourceSha256");
            var currentSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(sourcePath)))
                .ToLowerInvariant();
            if (currentSha256 != sourceSha256)
            {
                throw new InvalidDataException("Review queue item source bytes changed after verification.");
            }
            items.Add(new ReviewQueueItem(
                queue,
                artifactKind,
                ReadRequiredString(element, "artifactId"),
                ReadRequiredString(element, "subjectPack"),
                sourcePath,
                sourceSha256,
                ReadRequiredString(element, "reason")));
        }
        return items;
    }

    private static IReadOnlyList<ReviewQueueRejectedSource> ParseRejectedSources(JsonElement root)
    {
        var array = ReadRequiredArray(root, "rejectedSources");
        var rejectedSources = new List<ReviewQueueRejectedSource>();
        foreach (var element in array.EnumerateArray())
        {
            RequireExactProperties(element, ["sourcePath", "reason"]);
            rejectedSources.Add(new ReviewQueueRejectedSource(
                ReadRequiredAbsolutePath(element, "sourcePath"),
                ReadRequiredString(element, "reason")));
        }
        return rejectedSources;
    }

    private static void RequireExactProperties(JsonElement element, IReadOnlyCollection<string> allowed)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("Expected a JSON object.");
        }
        var observed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!allowed.Contains(property.Name, StringComparer.Ordinal)
                || !observed.Add(property.Name))
            {
                throw new InvalidDataException($"Unexpected or duplicate JSON property {property.Name}.");
            }
        }
        if (observed.Count != allowed.Count)
        {
            throw new InvalidDataException("JSON object is missing required properties.");
        }
    }

    private static JsonElement ReadRequiredObject(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"{propertyName} must be an object.");
        }
        return value;
    }

    private static JsonElement ReadRequiredArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException($"{propertyName} must be an array.");
        }
        return value;
    }

    private static bool ReadRequiredBoolean(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)
            || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException($"{propertyName} must be a boolean.");
        }
        return value.GetBoolean();
    }

    private static int ReadRequiredNonNegativeInteger(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)
            || !value.TryGetInt32(out var number)
            || number < 0)
        {
            throw new InvalidDataException($"{propertyName} must be a non-negative integer.");
        }
        return number;
    }

    private static string? ValidateProviderGenerationInput(
        string repositoryRoot,
        string toolPath,
        string requestPath,
        string workspaceRoot,
        string outputDirectoryPath,
        string configEnvFilePath,
        ProviderAnswerGenerationExecutionRequest request)
    {
        if (!request.AllowCloudEgress)
        {
            return "Provider generation requires explicit cloud-egress consent.";
        }
        if (!File.Exists(toolPath))
        {
            return $"Provider generator not found: {toolPath}";
        }
        if (!Directory.Exists(workspaceRoot))
        {
            return $"Provider generation workspace not found: {workspaceRoot}";
        }
        if (!File.Exists(requestPath) || !IsPathWithin(requestPath, workspaceRoot))
        {
            return "AnswerGenerationRequest must be an existing file within its workspace root.";
        }
        if (!File.Exists(configEnvFilePath))
        {
            return $"Provider configuration file not found: {configEnvFilePath}";
        }
        if (Directory.Exists(outputDirectoryPath) || File.Exists(outputDirectoryPath))
        {
            return "Provider generation output directory must not already exist.";
        }
        var outputParent = Path.GetDirectoryName(outputDirectoryPath);
        if (string.IsNullOrWhiteSpace(outputParent) || !Directory.Exists(outputParent))
        {
            return "Provider generation output parent directory must already exist.";
        }
        if (IsPathWithin(outputDirectoryPath, workspaceRoot)
            || IsPathWithin(outputDirectoryPath, repositoryRoot))
        {
            return "Provider generation output must be outside workspace and repository authority.";
        }
        if (request.TimeoutMilliseconds is < 1_000 or > 300_000)
        {
            return "Provider generation timeout must be from 1000 through 300000 milliseconds.";
        }
        if (request.MaxOutputTokens is < 256 or > 16_384)
        {
            return "Provider generation max output tokens must be from 256 through 16384.";
        }
        return null;
    }

    private static void ValidateProviderGenerationOutput(
        AnswerGenerationResult generation,
        AnswerGenerationRequest sourceRequest,
        byte[] sourceRequestBytes,
        byte[] answerBytes)
    {
        var disposition = generation.GenerationDisposition
            ?? throw new InvalidDataException("Generation disposition is missing.");
        if (!disposition.ReviewRequired
            || disposition.Trusted
            || !string.Equals(disposition.AcceptanceDisposition, "pending_review", StringComparison.Ordinal)
            || !string.Equals(disposition.WorkflowDisposition, "not_integrated", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Generation disposition is not fail-closed pending review.");
        }
        if (!string.Equals(generation.Provenance.ProviderKind, "model_provider", StringComparison.Ordinal)
            || !generation.Provenance.LiveProvider
            || generation.Provenance.CloudEgress != true)
        {
            throw new InvalidDataException("Provider provenance is not live cloud egress.");
        }
        if (!string.Equals(generation.CandidateArtifactRef, "answer.md", StringComparison.Ordinal)
            || !string.Equals(generation.RequestId, sourceRequest.RequestId, StringComparison.Ordinal)
            || !string.Equals(generation.SubjectPack, sourceRequest.SubjectPack, StringComparison.Ordinal))
        {
            throw new InvalidDataException("Generation identity or candidate reference does not match its request.");
        }
        if (!string.Equals(sourceRequest.DataClassification.Level, "public", StringComparison.Ordinal)
            || !string.Equals(generation.DataClassification.Level, sourceRequest.DataClassification.Level, StringComparison.Ordinal)
            || !string.Equals(generation.DataClassification.Notes, sourceRequest.DataClassification.Notes, StringComparison.Ordinal)
            || !string.Equals(generation.StopReason, "provider_generated_pending_review", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Generation classification or stop reason does not match the admitted boundary.");
        }
        var requestSha256 = Convert.ToHexString(SHA256.HashData(sourceRequestBytes)).ToLowerInvariant();
        var answerSha256 = Convert.ToHexString(SHA256.HashData(answerBytes)).ToLowerInvariant();
        if (!string.Equals(generation.SourceRequestSha256, requestSha256, StringComparison.Ordinal)
            || !string.Equals(generation.RawAnswerSha256, answerSha256, StringComparison.Ordinal)
            || !string.Equals(generation.AnswerMarkdown, Encoding.UTF8.GetString(answerBytes), StringComparison.Ordinal))
        {
            throw new InvalidDataException("Generated answer or source request hash binding failed.");
        }
    }

    private static ProviderAnswerGenerationExecutionResult ProviderGenerationFailure(
        string toolPath,
        DateTimeOffset startedAt,
        string output,
        int exitCode = -1)
    {
        var failed = ToolchainExecutionResult.Failure(
            ToolchainScriptKind.GenerateProviderAnswer,
            toolPath,
            exitCode,
            startedAt,
            DateTimeOffset.Now,
            output);
        return new ProviderAnswerGenerationExecutionResult(failed, null, null, null);
    }

    private static byte[] ReadBoundedFile(string path, string label)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"{label} was not materialized.", path);
        }
        var info = new FileInfo(path);
        if (info.Length is <= 0 or > 1_048_576)
        {
            throw new InvalidDataException($"{label} must be from 1 through 1048576 bytes.");
        }
        return File.ReadAllBytes(path);
    }

    private static bool IsPathWithin(string candidatePath, string rootPath)
    {
        var relative = Path.GetRelativePath(Path.GetFullPath(rootPath), Path.GetFullPath(candidatePath));
        return relative != "."
            && !string.Equals(relative, "..", StringComparison.Ordinal)
            && !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
            && !Path.IsPathRooted(relative);
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
