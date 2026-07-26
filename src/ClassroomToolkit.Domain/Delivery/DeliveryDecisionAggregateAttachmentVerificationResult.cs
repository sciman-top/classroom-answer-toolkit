using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Delivery;

public sealed record DeliveryDecisionAggregateAttachmentVerificationResult(
    ToolchainExecutionResult Execution,
    DeliveryDecisionAggregateAttachmentVerification? Verification,
    AnswerDeliveryResult? Delivery = null);
