using ClassroomToolkit.Application.Abstractions;
using System.IO;

namespace ClassroomToolkit.App.Services;

public sealed record HeadlessSmokeResult(
    string RepositoryRoot,
    string WorkspaceSummary,
    bool WorkspaceHealthy,
    string HealthSummary,
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks,
    string SnapshotPath,
    string? LastDeliverySubjectPack,
    string? LastDeliveryProfile,
    string? LastSnapshotId,
    string? LastDeliverySnapshotPath,
    string? LastDeliverySnapshotVersion,
    string? LastDeliveryInputPath,
    string? LastDeliveryOutputPath,
    string? LastDeliveryReviewDirectoryPath,
    string? LastDeliveryReviewState,
    int LastDeliveryFeedbackRefCount,
    string? LastDeliveryVisualDecisionRef,
    bool? LastDeliveryToolchainPassed,
    bool? LastDeliveryComplete,
    bool? LastDeliveryReviewArtifactReady,
    bool? LastDeliveryVisualReviewPassed,
    bool? LastDeliveryTrusted,
    string? LastDeliveryVisualPolicyVersion,
    string? LastDeliveryOptimizationVersion,
    int LastDeliveryGraphicCount,
    string DiagnosticsBundlePath,
    string DiagnosticsManifestPath,
    int DiagnosticsFileCount);

public interface IHeadlessSmokeRunner
{
    HeadlessSmokeResult Run();
}

public sealed class HeadlessSmokeRunner : IHeadlessSmokeRunner
{
    private readonly IToolchainOrchestrator _toolchainOrchestrator;
    private readonly IWorkspaceDiagnosticsExporter _workspaceDiagnosticsExporter;

    public HeadlessSmokeRunner(
        IToolchainOrchestrator toolchainOrchestrator,
        IWorkspaceDiagnosticsExporter workspaceDiagnosticsExporter)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _workspaceDiagnosticsExporter = workspaceDiagnosticsExporter;
    }

    public HeadlessSmokeResult Run()
    {
        var workspaceInfo = _toolchainOrchestrator.GetWorkspaceInfo();
        var healthReport = _toolchainOrchestrator.GetWorkspaceHealthReport();
        var diagnostics = _workspaceDiagnosticsExporter.Export(new WorkspaceDiagnosticsExportRequest(
            workspaceInfo.RepositoryRoot,
            healthReport,
            null,
            null,
            null,
            null));
        var lastDeliveryContext = ReadLastDeliveryContext(diagnostics.ManifestPath);

        return new HeadlessSmokeResult(
            workspaceInfo.RepositoryRoot,
            workspaceInfo.Summary,
            healthReport.IsHealthy,
            healthReport.Summary,
            healthReport.PrimarySubjectPack,
            healthReport.SubjectPacks,
            healthReport.SnapshotPath,
            lastDeliveryContext.SubjectPack,
            lastDeliveryContext.Profile,
            lastDeliveryContext.SnapshotId,
            lastDeliveryContext.SnapshotPath,
            lastDeliveryContext.SnapshotVersion,
            lastDeliveryContext.InputPath,
            lastDeliveryContext.OutputPath,
            lastDeliveryContext.ReviewDirectoryPath,
            lastDeliveryContext.ReviewState,
            lastDeliveryContext.FeedbackRefCount,
            lastDeliveryContext.VisualDecisionRef,
            lastDeliveryContext.ToolchainPassed,
            lastDeliveryContext.DeliveryComplete,
            lastDeliveryContext.ReviewArtifactReady,
            lastDeliveryContext.VisualReviewPassed,
            lastDeliveryContext.Trusted,
            lastDeliveryContext.VisualPolicyVersion,
            lastDeliveryContext.OptimizationVersion,
            lastDeliveryContext.GraphicCount,
            diagnostics.BundleDirectoryPath,
            diagnostics.ManifestPath,
            diagnostics.FileCount);
    }

    private static (
        string? SubjectPack,
        string? Profile,
        string? SnapshotId,
        string? SnapshotPath,
        string? SnapshotVersion,
        string? InputPath,
        string? OutputPath,
        string? ReviewDirectoryPath,
        string? ReviewState,
        int FeedbackRefCount,
        string? VisualDecisionRef,
        bool? ToolchainPassed,
        bool? DeliveryComplete,
        bool? ReviewArtifactReady,
        bool? VisualReviewPassed,
        bool? Trusted,
        string? VisualPolicyVersion,
        string? OptimizationVersion,
        int GraphicCount) ReadLastDeliveryContext(string manifestPath)
    {
        if (!File.Exists(manifestPath))
        {
            return (null, null, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null, null, 0);
        }

        using var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifestPath));
        if (!document.RootElement.TryGetProperty("lastDeliveryContext", out var deliveryContextElement))
        {
            return (null, null, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null, null, 0);
        }

        if (deliveryContextElement.ValueKind is System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined)
        {
            return (null, null, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null, null, 0);
        }

        var statusElementExists = deliveryContextElement.TryGetProperty("status", out var statusElement)
            && statusElement.ValueKind == System.Text.Json.JsonValueKind.Object;
        var reviewElementExists = deliveryContextElement.TryGetProperty("review", out var reviewElement)
            && reviewElement.ValueKind == System.Text.Json.JsonValueKind.Object;
        var policyElementExists = deliveryContextElement.TryGetProperty("policy", out var policyElement)
            && policyElement.ValueKind == System.Text.Json.JsonValueKind.Object;
        var graphicCount = deliveryContextElement.TryGetProperty("graphics", out var graphicsElement)
            && graphicsElement.TryGetProperty("count", out var graphicCountElement)
            && graphicCountElement.ValueKind == System.Text.Json.JsonValueKind.Number
                ? graphicCountElement.GetInt32()
                : 0;
        var feedbackRefCount = reviewElementExists
            && reviewElement.TryGetProperty("feedbackRefs", out var feedbackRefsElement)
            && feedbackRefsElement.ValueKind == System.Text.Json.JsonValueKind.Array
                ? feedbackRefsElement.GetArrayLength()
                : 0;

        return (
            deliveryContextElement.TryGetProperty("subjectPack", out var subjectPackElement) ? subjectPackElement.GetString() : null,
            deliveryContextElement.TryGetProperty("profile", out var profileElement) ? profileElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotId", out var snapshotIdElement) ? snapshotIdElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotPath", out var snapshotPathElement) ? snapshotPathElement.GetString() : null,
            deliveryContextElement.TryGetProperty("snapshotVersion", out var snapshotVersionElement) ? snapshotVersionElement.GetString() : null,
            deliveryContextElement.TryGetProperty("input", out var inputElement) ? inputElement.GetString() : null,
            deliveryContextElement.TryGetProperty("output", out var outputElement) ? outputElement.GetString() : null,
            deliveryContextElement.TryGetProperty("reviewDirectoryPath", out var reviewDirectoryPathElement) ? reviewDirectoryPathElement.GetString() : null,
            reviewElementExists
                && reviewElement.TryGetProperty("lifecycle", out var lifecycleElement)
                && lifecycleElement.ValueKind == System.Text.Json.JsonValueKind.Object
                && lifecycleElement.TryGetProperty("state", out var reviewStateElement)
                    ? reviewStateElement.GetString()
                    : null,
            feedbackRefCount,
            reviewElementExists && reviewElement.TryGetProperty("visualDecisionRef", out var visualDecisionRefElement)
                ? visualDecisionRefElement.GetString()
                : null,
            ReadNullableBoolean(statusElementExists, statusElement, "toolchainPassed"),
            ReadNullableBoolean(statusElementExists, statusElement, "deliveryComplete"),
            ReadNullableBoolean(statusElementExists, statusElement, "reviewArtifactReady"),
            ReadNullableBoolean(statusElementExists, statusElement, "visualReviewPassed"),
            ReadNullableBoolean(statusElementExists, statusElement, "trusted"),
            ReadOptionalString(policyElementExists, policyElement, "visualPolicyVersion"),
            ReadOptionalString(policyElementExists, policyElement, "optimizationVersion"),
            graphicCount);
    }

    private static bool? ReadNullableBoolean(
        bool parentExists,
        System.Text.Json.JsonElement parent,
        string propertyName)
    {
        if (!parentExists || !parent.TryGetProperty(propertyName, out var valueElement))
        {
            return null;
        }

        return valueElement.ValueKind switch
        {
            System.Text.Json.JsonValueKind.True => true,
            System.Text.Json.JsonValueKind.False => false,
            _ => null
        };
    }

    private static string? ReadOptionalString(
        bool parentExists,
        System.Text.Json.JsonElement parent,
        string propertyName)
    {
        if (!parentExists || !parent.TryGetProperty(propertyName, out var valueElement))
        {
            return null;
        }

        return valueElement.ValueKind == System.Text.Json.JsonValueKind.String
            ? valueElement.GetString()
            : null;
    }
}
