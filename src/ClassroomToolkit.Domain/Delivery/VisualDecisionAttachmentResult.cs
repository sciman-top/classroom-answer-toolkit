using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Delivery;

public sealed record VisualDecisionAttachmentResult(
    ToolchainExecutionResult Execution,
    AnswerDeliveryResult? Delivery);
