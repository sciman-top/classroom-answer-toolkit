using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Delivery;

public sealed record DeliveryDecisionAggregateAttachmentResult(
    ToolchainExecutionResult AttachmentExecution,
    DeliveryDecisionAggregateAttachmentVerificationResult? Verification)
{
    public bool Succeeded =>
        AttachmentExecution.Succeeded
        && Verification is
        {
            Execution.Succeeded: true,
            Verification: not null,
            Delivery: not null
        };
}
