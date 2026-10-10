using ClassroomToolkit.Domain.Delivery;

namespace ClassroomToolkit.Domain.Toolchain;

public interface IToolchainOrchestrator
{
    ToolchainWorkspaceInfo GetWorkspaceInfo();

    Task<WorkspaceHealthReport> GetWorkspaceHealthReportAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default);

    // The progress sink receives child-process output lines while the script
    // still runs, so the UI can show which toolchain step is active instead of
    // a silent wait that reads as a freeze.
    Task<ToolchainExecutionResult> RunBootstrapAsync(
        CancellationToken cancellationToken = default,
        Action<string>? progress = null);

    // The health report is only populated by packaged runtimes, whose check IS
    // a health probe; returning it lets the UI refresh its cards without a
    // second Node cold start. Source check runs a real script and returns null.
    Task<(ToolchainExecutionResult Execution, WorkspaceHealthReport? HealthReport)> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null);

    Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null);
}
