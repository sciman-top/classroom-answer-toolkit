using System.Text.Json;
using System.IO;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.App.Services;

public sealed record WorkspaceDiagnosticsAssetRecord(
    string Kind,
    string SourcePath,
    string TargetPath,
    bool Exists);

public sealed record WorkspaceDiagnosticsSubjectPackRecord(
    string AssetId,
    string Status,
    bool IsPrimary,
    string? Version,
    string ManifestPath,
    string ConfigPath,
    string SnapshotPath,
    bool SnapshotExists,
    string? SnapshotVersion,
    string? SnapshotProfile,
    string EvalResultsPath,
    bool EvalExists,
    bool EvalOk,
    int EvalCaseCount,
    string? HumanSpecPath,
    bool HumanSpecExists,
    string? MirroredSpecPath,
    bool MirroredSpecExists,
    string? AcceptanceChecklistPath,
    bool AcceptanceChecklistExists);

public sealed record WorkspaceDiagnosticsDeliveryGraphicRecord(
    string? PlacementPath,
    string? PreviewPath,
    string? PlacedGraphicId,
    string? GraphicId,
    string? ArtifactId,
    string? QuestionRef,
    string? PlacementMode);

public sealed record WorkspaceDiagnosticsDeliveryGraphicIndexRecord(
    string BundleId,
    string? PlacedGraphicId,
    string? GraphicId,
    string? ArtifactId,
    string? QuestionRef,
    string? PlacementMode,
    string? PlacementBundlePath,
    string? PreviewBundlePath,
    string? SourcePlacementPath,
    string? SourcePreviewPath);

public sealed record WorkspaceDiagnosticsOcrRecord(
    string? Status,
    string? Provider,
    string? Version,
    string? Language,
    int? PageCount,
    string? Error);

public sealed record WorkspaceDiagnosticsReviewLifecycleRecord(
    string? State,
    string? UpdatedAt,
    string? Actor,
    string? Notes);

public sealed record WorkspaceDiagnosticsReviewRecord(
    string? OutputDir,
    string? ManifestPath,
    string? Scale,
    WorkspaceDiagnosticsReviewLifecycleRecord? Lifecycle,
    IReadOnlyList<string> FeedbackRefs,
    string? VisualDecisionRef);

public sealed record WorkspaceDiagnosticsPolicyRecord(
    string? VisualPolicyVersion,
    string? OptimizationVersion);

public sealed class WorkspaceDiagnosticsExporter : IWorkspaceDiagnosticsExporter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request)
    {
        var repositoryRoot = Path.GetFullPath(request.RepositoryRoot);
        var bundleRoot = Path.Combine(
            repositoryRoot,
            "artifacts",
            "diagnostics",
            $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}");

        Directory.CreateDirectory(bundleRoot);

        var assets = new List<WorkspaceDiagnosticsAssetRecord>();
        var workspaceRoot = Path.Combine(bundleRoot, "workspace");
        var deliveryRoot = Path.Combine(bundleRoot, "delivery");
        var subjectPacks = WorkspaceSubjectPackLocator.FindSubjectPacks(repositoryRoot);
        var primarySubjectPack = subjectPacks.FirstOrDefault(pack =>
                string.Equals(pack.AssetId, request.HealthReport.PrimarySubjectPack, StringComparison.OrdinalIgnoreCase))
            ?? subjectPacks.FirstOrDefault();
        var subjectPackManifestPath = primarySubjectPack?.ManifestPath ?? Path.Combine(repositoryRoot, "prompts", "junior-physics-answer", "manifest.json");
        var subjectPackConfigPath = primarySubjectPack?.ConfigPath ?? Path.Combine(repositoryRoot, "prompts", "junior-physics-answer", "config.json");
        var subjectPackEvalPath = primarySubjectPack?.EvalResultsPath ?? Path.Combine(repositoryRoot, "eval", "junior-physics-answer", "results", "latest.json");
        var subjectPackSnapshotPath = primarySubjectPack?.SnapshotPath ?? Path.Combine(repositoryRoot, ".snapshot-cache", "resolved-snapshot.json");
        var subjectPackAssetId = primarySubjectPack?.AssetId ?? "junior-physics-answer";

        CopyFileIfExists(
            subjectPackManifestPath,
            Path.Combine(workspaceRoot, "prompts", subjectPackAssetId, "manifest.json"),
            "manifest",
            assets);
        CopyFileIfExists(
            subjectPackConfigPath,
            Path.Combine(workspaceRoot, "prompts", subjectPackAssetId, "config.json"),
            "config",
            assets);
        CopyFileIfExists(
            subjectPackSnapshotPath,
            Path.Combine(workspaceRoot, "snapshot", Path.GetFileName(subjectPackSnapshotPath)),
            "snapshot",
            assets);
        CopyFileIfExists(
            subjectPackEvalPath,
            Path.Combine(workspaceRoot, "eval", "latest.json"),
            "eval",
            assets);
        CopySubjectPackSourceOfTruth(
            repositoryRoot,
            subjectPackManifestPath,
            subjectPackConfigPath,
            workspaceRoot,
            assets);
        CopyDirectoryIfExists(
            Path.Combine(repositoryRoot, ".answer-graphics"),
            Path.Combine(workspaceRoot, "answer-graphics"),
            "answer-graphics",
            assets);
        WriteSubjectPackIndex(subjectPacks, primarySubjectPack?.AssetId, workspaceRoot, assets);

        CopyFileIfExists(
            request.LastOutputPdfPath,
            Path.Combine(deliveryRoot, "answer.pdf"),
            "latest-pdf",
            assets);
        CopyFileIfExists(
            request.LastDeliveryManifestPath,
            Path.Combine(deliveryRoot, "delivery-manifest.json"),
            "latest-delivery-manifest",
            assets);
        CopyDeliveryGraphicsIfExists(
            request.LastDeliveryManifestPath,
            Path.Combine(deliveryRoot, "graphics"),
            assets);
        CopyDirectoryIfExists(
            request.LastReviewDirectoryPath,
            Path.Combine(deliveryRoot, "review"),
            "latest-review",
            assets);

        var manifestPath = Path.Combine(bundleRoot, "diagnostic-manifest.json");
        assets.Add(new WorkspaceDiagnosticsAssetRecord(
            "diagnostic-manifest",
            manifestPath,
            manifestPath,
            true));

        var lastDeliveryContext = ReadLastDeliveryContext(request.LastDeliveryManifestPath);

        var manifest = new
        {
            schemaVersion = "1.0",
            kind = "workspace-diagnostics-bundle",
            generatedAt = DateTimeOffset.Now.ToString("O"),
            bundleDirectoryPath = bundleRoot,
            repositoryRoot,
            primarySubjectPack = request.HealthReport.PrimarySubjectPack ?? subjectPackAssetId,
            subjectPacks = request.HealthReport.SubjectPacks,
            snapshotPath = request.HealthReport.SnapshotPath,
            lastSnapshotId = request.LastSnapshotId,
            lastDeliveryContext,
            lastOutputPdfPath = request.LastOutputPdfPath,
            lastDeliveryManifestPath = request.LastDeliveryManifestPath,
            lastReviewDirectoryPath = request.LastReviewDirectoryPath,
            health = request.HealthReport,
            assets
        };

        File.WriteAllText(
            manifestPath,
            JsonSerializer.Serialize(manifest, JsonOptions) + Environment.NewLine,
            System.Text.Encoding.UTF8);

        return new WorkspaceDiagnosticsExportResult(bundleRoot, manifestPath, assets.Count);
    }

    private static void WriteSubjectPackIndex(
        IReadOnlyList<WorkspaceSubjectPackPaths> subjectPacks,
        string? primarySubjectPackAssetId,
        string workspaceRoot,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        var subjectPacksRoot = Path.Combine(workspaceRoot, "subject-packs");
        Directory.CreateDirectory(subjectPacksRoot);

        var records = new List<WorkspaceDiagnosticsSubjectPackRecord>();
        foreach (var subjectPack in subjectPacks)
        {
            var packRoot = Path.Combine(subjectPacksRoot, subjectPack.AssetId);
            CopyFileIfExists(
                subjectPack.ManifestPath,
                Path.Combine(packRoot, "manifest.json"),
                "subject-pack-manifest",
                assets);
            CopyFileIfExists(
                subjectPack.ConfigPath,
                Path.Combine(packRoot, "config.json"),
                "subject-pack-config",
                assets);
            CopyFileIfExists(
                subjectPack.SnapshotPath,
                Path.Combine(packRoot, "snapshot", Path.GetFileName(subjectPack.SnapshotPath)),
                "subject-pack-snapshot",
                assets);
            CopyFileIfExists(
                subjectPack.EvalResultsPath,
                Path.Combine(packRoot, "eval", "latest.json"),
                "subject-pack-eval",
                assets);
            var sourceOfTruth = ReadSubjectPackSourceOfTruth(subjectPack.ManifestPath, subjectPack.ConfigPath);
            CopySubjectPackSourceOfTruthFiles(packRoot, sourceOfTruth, assets);

            records.Add(new WorkspaceDiagnosticsSubjectPackRecord(
                subjectPack.AssetId,
                subjectPack.Status,
                string.Equals(subjectPack.AssetId, primarySubjectPackAssetId, StringComparison.OrdinalIgnoreCase),
                ReadSubjectPackVersion(subjectPack.ManifestPath),
                subjectPack.ManifestPath,
                subjectPack.ConfigPath,
                subjectPack.SnapshotPath,
                File.Exists(subjectPack.SnapshotPath),
                ReadSnapshotVersion(subjectPack.SnapshotPath),
                ReadSnapshotProfile(subjectPack.SnapshotPath),
                subjectPack.EvalResultsPath,
                File.Exists(subjectPack.EvalResultsPath),
                ReadEvalStatus(subjectPack.EvalResultsPath).Ok,
                ReadEvalStatus(subjectPack.EvalResultsPath).CaseCount,
                sourceOfTruth.HumanSpecPath,
                File.Exists(sourceOfTruth.HumanSpecPath ?? string.Empty),
                sourceOfTruth.MirroredSpecPath,
                File.Exists(sourceOfTruth.MirroredSpecPath ?? string.Empty),
                sourceOfTruth.AcceptanceChecklistPath,
                File.Exists(sourceOfTruth.AcceptanceChecklistPath ?? string.Empty)));
        }

        var indexPath = Path.Combine(subjectPacksRoot, "index.json");
        File.WriteAllText(
            indexPath,
            JsonSerializer.Serialize(records, JsonOptions) + Environment.NewLine,
            System.Text.Encoding.UTF8);
        assets.Add(new WorkspaceDiagnosticsAssetRecord(
            "subject-pack-index",
            indexPath,
            indexPath,
            true));
    }

    private static void CopyFileIfExists(
        string? sourcePath,
        string destinationPath,
        string kind,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
        {
            return;
        }

        var fullSourcePath = Path.GetFullPath(sourcePath);
        if (!File.Exists(fullSourcePath))
        {
            assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourcePath, destinationPath, false));
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        File.Copy(fullSourcePath, destinationPath, overwrite: true);
        assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourcePath, destinationPath, true));
    }

    private static void CopyDirectoryIfExists(
        string? sourceDirectory,
        string destinationDirectory,
        string kind,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(sourceDirectory))
        {
            return;
        }

        var fullSourceDirectory = Path.GetFullPath(sourceDirectory);
        if (!Directory.Exists(fullSourceDirectory))
        {
            assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourceDirectory, destinationDirectory, false));
            return;
        }

        CopyDirectory(fullSourceDirectory, destinationDirectory);
        assets.Add(new WorkspaceDiagnosticsAssetRecord(kind, fullSourceDirectory, destinationDirectory, true));
    }

    private static void CopySubjectPackSourceOfTruth(
        string repositoryRoot,
        string manifestPath,
        string configPath,
        string workspaceRoot,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        var sourceOfTruth = ReadSubjectPackSourceOfTruth(manifestPath, configPath);
        CopySourceOfTruthFileToWorkspace(repositoryRoot, workspaceRoot, sourceOfTruth.HumanSpecPath, "subject-pack-human-spec", assets);
        CopySourceOfTruthFileToWorkspace(repositoryRoot, workspaceRoot, sourceOfTruth.MirroredSpecPath, "subject-pack-mirrored-spec", assets);
        CopySourceOfTruthFileToWorkspace(repositoryRoot, workspaceRoot, sourceOfTruth.AcceptanceChecklistPath, "subject-pack-acceptance-checklist", assets);
    }

    private static void CopySubjectPackSourceOfTruthFiles(
        string packRoot,
        SubjectPackSourceOfTruthPaths sourceOfTruth,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        var sourceOfTruthRoot = Path.Combine(packRoot, "source-of-truth");
        CopyFileIfExists(
            sourceOfTruth.HumanSpecPath,
            Path.Combine(sourceOfTruthRoot, Path.GetFileName(sourceOfTruth.HumanSpecPath ?? "human-spec.md")),
            "subject-pack-human-spec",
            assets);
        CopyFileIfExists(
            sourceOfTruth.MirroredSpecPath,
            Path.Combine(sourceOfTruthRoot, Path.GetFileName(sourceOfTruth.MirroredSpecPath ?? "spec.md")),
            "subject-pack-mirrored-spec",
            assets);
        CopyFileIfExists(
            sourceOfTruth.AcceptanceChecklistPath,
            Path.Combine(sourceOfTruthRoot, Path.GetFileName(sourceOfTruth.AcceptanceChecklistPath ?? "acceptance.md")),
            "subject-pack-acceptance-checklist",
            assets);
    }

    private static void CopySourceOfTruthFileToWorkspace(
        string repositoryRoot,
        string workspaceRoot,
        string? sourcePath,
        string kind,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
        {
            return;
        }

        var fullSourcePath = Path.GetFullPath(sourcePath);
        var relativePath = Path.GetRelativePath(repositoryRoot, fullSourcePath);
        var destinationPath = Path.Combine(workspaceRoot, relativePath);
        CopyFileIfExists(fullSourcePath, destinationPath, kind, assets);
    }

    private static void CopyDeliveryGraphicsIfExists(
        string? deliveryManifestPath,
        string destinationDirectory,
        ICollection<WorkspaceDiagnosticsAssetRecord> assets)
    {
        if (string.IsNullOrWhiteSpace(deliveryManifestPath))
        {
            return;
        }

        var fullManifestPath = Path.GetFullPath(deliveryManifestPath);
        if (!File.Exists(fullManifestPath))
        {
            return;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(fullManifestPath));
        var graphics = ReadDeliveryGraphics(document.RootElement, Path.GetDirectoryName(fullManifestPath));
        var indexRecords = new List<WorkspaceDiagnosticsDeliveryGraphicIndexRecord>();
        for (var index = 0; index < graphics.Count; index += 1)
        {
            var graphic = graphics[index];
            var bundleId = $"{index + 1:000}";
            var graphicRoot = Path.Combine(destinationDirectory, bundleId);
            var placementBundlePath = Path.Combine(graphicRoot, "placed-answer-graphic.json");
            var previewBundlePath = Path.Combine(graphicRoot, "preview" + Path.GetExtension(graphic.PreviewPath ?? ".svg"));
            CopyFileIfExists(
                graphic.PlacementPath,
                placementBundlePath,
                "latest-delivery-graphic-placement",
                assets);
            CopyFileIfExists(
                graphic.PreviewPath,
                previewBundlePath,
                "latest-delivery-graphic-preview",
                assets);
            indexRecords.Add(new WorkspaceDiagnosticsDeliveryGraphicIndexRecord(
                bundleId,
                graphic.PlacedGraphicId,
                graphic.GraphicId,
                graphic.ArtifactId,
                graphic.QuestionRef,
                graphic.PlacementMode,
                File.Exists(placementBundlePath) ? placementBundlePath : null,
                File.Exists(previewBundlePath) ? previewBundlePath : null,
                graphic.PlacementPath,
                graphic.PreviewPath));
        }

        if (indexRecords.Count > 0)
        {
            Directory.CreateDirectory(destinationDirectory);
            var indexPath = Path.Combine(destinationDirectory, "index.json");
            File.WriteAllText(
                indexPath,
                JsonSerializer.Serialize(indexRecords, JsonOptions) + Environment.NewLine,
                System.Text.Encoding.UTF8);
            assets.Add(new WorkspaceDiagnosticsAssetRecord(
                "latest-delivery-graphic-index",
                indexPath,
                indexPath,
                true));
        }
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        Directory.CreateDirectory(destinationDirectory);

        foreach (var filePath in Directory.EnumerateFiles(sourceDirectory))
        {
            var destinationPath = Path.Combine(destinationDirectory, Path.GetFileName(filePath));
            File.Copy(filePath, destinationPath, overwrite: true);
        }

        foreach (var subDirectory in Directory.EnumerateDirectories(sourceDirectory))
        {
            var destinationPath = Path.Combine(destinationDirectory, Path.GetFileName(subDirectory));
            CopyDirectory(subDirectory, destinationPath);
        }
    }

    private static string? ReadSubjectPackVersion(string manifestPath)
    {
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        return document.RootElement.TryGetProperty("version", out var versionElement)
            ? versionElement.GetString()
            : null;
    }

    private static SubjectPackSourceOfTruthPaths ReadSubjectPackSourceOfTruth(string manifestPath, string configPath)
    {
        return new SubjectPackSourceOfTruthPaths(
            ReadSourceOfTruthPath(manifestPath, "humanSpec") ?? ReadSourceOfTruthPath(configPath, "humanSpec"),
            ReadSourceOfTruthPath(manifestPath, "mirroredSpec") ?? ReadSourceOfTruthPath(configPath, "mirroredSpec"),
            ReadSourceOfTruthPath(manifestPath, "acceptanceChecklist") ?? ReadSourceOfTruthPath(configPath, "acceptanceChecklist"));
    }

    private static string? ReadSourceOfTruthPath(string jsonPath, string propertyName)
    {
        if (!File.Exists(jsonPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(jsonPath));
        if (!document.RootElement.TryGetProperty("sourceOfTruth", out var sourceOfTruthElement)
            || !sourceOfTruthElement.TryGetProperty(propertyName, out var propertyElement))
        {
            return null;
        }

        var relativePath = propertyElement.GetString();
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return null;
        }

        return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(jsonPath)!, relativePath));
    }

    private static string? ReadSnapshotVersion(string snapshotPath)
    {
        if (!File.Exists(snapshotPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(snapshotPath));
        return document.RootElement.TryGetProperty("subjectPack", out var subjectPackElement)
            && subjectPackElement.TryGetProperty("version", out var versionElement)
                ? versionElement.GetString()
                : null;
    }

    private static string? ReadSnapshotProfile(string snapshotPath)
    {
        if (!File.Exists(snapshotPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(snapshotPath));
        return document.RootElement.TryGetProperty("activeProfile", out var profileElement)
            && profileElement.TryGetProperty("name", out var nameElement)
                ? nameElement.GetString()
                : null;
    }

    private static (bool Ok, int CaseCount) ReadEvalStatus(string evalResultsPath)
    {
        if (!File.Exists(evalResultsPath))
        {
            return (false, 0);
        }

        using var document = JsonDocument.Parse(File.ReadAllText(evalResultsPath));
        var ok = document.RootElement.TryGetProperty("ok", out var okElement) && okElement.GetBoolean();
        var caseCount = document.RootElement.TryGetProperty("cases", out var casesElement)
            ? casesElement.GetArrayLength()
            : 0;
        return (ok, caseCount);
    }

    private static object? ReadLastDeliveryContext(string? deliveryManifestPath)
    {
        if (string.IsNullOrWhiteSpace(deliveryManifestPath))
        {
            return null;
        }

        var fullPath = Path.GetFullPath(deliveryManifestPath);
        if (!File.Exists(fullPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(fullPath));
        var root = document.RootElement;
        var snapshotId = root.TryGetProperty("snapshotId", out var snapshotIdElement)
            ? snapshotIdElement.GetString()
            : null;
        var snapshotPath = root.TryGetProperty("snapshotPath", out var snapshotPathElement)
            ? snapshotPathElement.GetString()
            : null;
        var profile = root.TryGetProperty("profile", out var profileElement)
            ? profileElement.GetString()
            : null;
        var input = root.TryGetProperty("input", out var inputElement)
            ? inputElement.GetString()
            : null;
        var output = root.TryGetProperty("output", out var outputElement)
            ? outputElement.GetString()
            : null;
        var subjectPack = root.TryGetProperty("subjectPack", out var subjectPackElement)
            ? subjectPackElement.GetString()
            : null;
        var reviewDirectoryPath = root.TryGetProperty("review", out var reviewElement)
            && reviewElement.TryGetProperty("outputDir", out var reviewOutputDirElement)
                ? reviewOutputDirElement.GetString()
                : null;
        var reviewManifestPath = root.TryGetProperty("review", out reviewElement)
            && reviewElement.TryGetProperty("manifestPath", out var reviewManifestPathElement)
                ? reviewManifestPathElement.GetString()
                : null;
        var reviewScale = root.TryGetProperty("review", out reviewElement)
            && reviewElement.TryGetProperty("scale", out var reviewScaleElement)
                ? reviewScaleElement.GetString()
                : null;
        var snapshotVersion = root.TryGetProperty("snapshot", out var snapshotElement)
            && snapshotElement.TryGetProperty("version", out var versionElement)
                ? versionElement.GetString()
                : null;
        var toolchainPassed = root.TryGetProperty("status", out var statusElement)
            && statusElement.TryGetProperty("toolchainPassed", out var toolchainPassedElement)
                ? toolchainPassedElement.GetBoolean()
                : (bool?)null;
        var deliveryComplete = root.TryGetProperty("status", out statusElement)
            && statusElement.TryGetProperty("deliveryComplete", out var deliveryCompleteElement)
                ? deliveryCompleteElement.GetBoolean()
                : (bool?)null;
        var reviewArtifactReady = root.TryGetProperty("status", out statusElement)
            && statusElement.TryGetProperty("reviewArtifactReady", out var reviewArtifactReadyElement)
                ? reviewArtifactReadyElement.GetBoolean()
                : (bool?)null;
        var visualReviewPassed = root.TryGetProperty("status", out statusElement)
            && statusElement.TryGetProperty("visualReviewPassed", out var visualReviewPassedElement)
            && visualReviewPassedElement.ValueKind != JsonValueKind.Null
                ? visualReviewPassedElement.GetBoolean()
                : (bool?)null;
        var trusted = root.TryGetProperty("status", out statusElement)
            && statusElement.TryGetProperty("trusted", out var trustedElement)
                ? trustedElement.GetBoolean()
                : (bool?)null;
        var ocr = ReadDeliveryOcr(root);
        var graphics = ReadDeliveryGraphics(root, Path.GetDirectoryName(fullPath));
        var review = ReadDeliveryReview(root);
        var policy = ReadDeliveryPolicy(root);

        return new
        {
            subjectPack,
            profile,
            snapshotId,
            snapshotPath,
            snapshotVersion,
            input,
            output,
            reviewDirectoryPath,
            review = new WorkspaceDiagnosticsReviewRecord(
                reviewDirectoryPath,
                reviewManifestPath,
                reviewScale,
                review.Lifecycle,
                review.FeedbackRefs,
                review.VisualDecisionRef),
            policy,
            status = new
            {
                toolchainPassed,
                deliveryComplete,
                reviewArtifactReady,
                visualReviewPassed,
                trusted
            },
            ocr,
            graphics = new
            {
                count = graphics.Count,
                items = graphics
            }
        };
    }

    private static WorkspaceDiagnosticsReviewRecord ReadDeliveryReview(JsonElement root)
    {
        if (!root.TryGetProperty("review", out var reviewElement) || reviewElement.ValueKind != JsonValueKind.Object)
        {
            return new WorkspaceDiagnosticsReviewRecord(null, null, null, null, Array.Empty<string>(), null);
        }

        var lifecycle = reviewElement.TryGetProperty("lifecycle", out var lifecycleElement)
            && lifecycleElement.ValueKind == JsonValueKind.Object
                ? new WorkspaceDiagnosticsReviewLifecycleRecord(
                    ReadOptionalString(lifecycleElement, "state"),
                    ReadOptionalString(lifecycleElement, "updatedAt"),
                    ReadOptionalString(lifecycleElement, "actor"),
                    ReadOptionalString(lifecycleElement, "notes"))
                : null;

        return new WorkspaceDiagnosticsReviewRecord(
            ReadOptionalString(reviewElement, "outputDir"),
            ReadOptionalString(reviewElement, "manifestPath"),
            ReadOptionalString(reviewElement, "scale"),
            lifecycle,
            ReadOptionalStringArray(reviewElement, "feedbackRefs"),
            ReadOptionalString(reviewElement, "visualDecisionRef"));
    }

    private static WorkspaceDiagnosticsPolicyRecord? ReadDeliveryPolicy(JsonElement root)
    {
        if (!root.TryGetProperty("policy", out var policyElement) || policyElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new WorkspaceDiagnosticsPolicyRecord(
            ReadOptionalString(policyElement, "visualPolicyVersion"),
            ReadOptionalString(policyElement, "optimizationVersion"));
    }

    private static WorkspaceDiagnosticsOcrRecord ReadDeliveryOcr(JsonElement root)
    {
        if (!root.TryGetProperty("ocr", out var ocrElement) || ocrElement.ValueKind != JsonValueKind.Object)
        {
            return new WorkspaceDiagnosticsOcrRecord(null, null, null, null, null, null);
        }

        var pageCount = ocrElement.TryGetProperty("pageCount", out var pageCountElement)
            && pageCountElement.ValueKind == JsonValueKind.Number
            && pageCountElement.TryGetInt32(out var pageCountValue)
                ? pageCountValue
                : (int?)null;

        return new WorkspaceDiagnosticsOcrRecord(
            ReadOptionalString(ocrElement, "status"),
            ReadOptionalString(ocrElement, "provider"),
            ReadOptionalString(ocrElement, "version"),
            ReadOptionalString(ocrElement, "language"),
            pageCount,
            ReadOptionalString(ocrElement, "error"));
    }

    private static IReadOnlyList<WorkspaceDiagnosticsDeliveryGraphicRecord> ReadDeliveryGraphics(JsonElement root, string? manifestDirectory)
    {
        if (!root.TryGetProperty("graphics", out var graphicsElement)
            || !graphicsElement.TryGetProperty("items", out var itemsElement)
            || itemsElement.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<WorkspaceDiagnosticsDeliveryGraphicRecord>();
        }

        var items = new List<WorkspaceDiagnosticsDeliveryGraphicRecord>();
        foreach (var itemElement in itemsElement.EnumerateArray())
        {
            items.Add(new WorkspaceDiagnosticsDeliveryGraphicRecord(
                ResolveDeliveryManifestPath(ReadOptionalString(itemElement, "placementPath"), manifestDirectory),
                ResolveDeliveryManifestPath(ReadOptionalString(itemElement, "previewPath"), manifestDirectory),
                ReadOptionalString(itemElement, "placedGraphicId"),
                ReadOptionalString(itemElement, "graphicId"),
                ReadOptionalString(itemElement, "artifactId"),
                ReadOptionalString(itemElement, "questionRef"),
                ReadOptionalString(itemElement, "placementMode")));
        }

        return items;
    }

    private static string? ResolveDeliveryManifestPath(string? pathValue, string? manifestDirectory)
    {
        if (string.IsNullOrWhiteSpace(pathValue) || string.IsNullOrWhiteSpace(manifestDirectory))
        {
            return pathValue;
        }

        return Path.IsPathFullyQualified(pathValue)
            ? pathValue
            : Path.GetFullPath(Path.Combine(manifestDirectory, pathValue));
    }

    private static string? ReadOptionalString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var valueElement)
            && valueElement.ValueKind == JsonValueKind.String
                ? valueElement.GetString()
                : null;
    }

    private static IReadOnlyList<string> ReadOptionalStringArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var valueElement) || valueElement.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return valueElement
            .EnumerateArray()
            .Where(static item => item.ValueKind == JsonValueKind.String)
            .Select(static item => item.GetString())
            .Where(static item => !string.IsNullOrWhiteSpace(item))
            .Cast<string>()
            .ToArray();
    }

    private sealed record SubjectPackSourceOfTruthPaths(
        string? HumanSpecPath,
        string? MirroredSpecPath,
        string? AcceptanceChecklistPath);
}
