using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Toolchain;

public interface IToolchainOrchestrator
{
    ToolchainWorkspaceInfo GetWorkspaceInfo();

    WorkspaceHealthReport GetWorkspaceHealthReport(string? subjectPack = null);

    Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default);

    Task<ToolchainExecutionResult> RunCheckAsync(
        string? subjectPack = null,
        CancellationToken cancellationToken = default);

    Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default);
}
