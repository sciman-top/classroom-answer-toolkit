using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Application.Abstractions;

public interface IToolchainOrchestrator
{
    ToolchainWorkspaceInfo GetWorkspaceInfo();

    WorkspaceHealthReport GetWorkspaceHealthReport();

    Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default);

    Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default);

    Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
        AnswerDeliveryRequest request,
        CancellationToken cancellationToken = default);
}
