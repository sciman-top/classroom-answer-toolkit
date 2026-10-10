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

    Task<ToolchainExecutionResult> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null);

    Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default,
        Action<string>? progress = null);
}
