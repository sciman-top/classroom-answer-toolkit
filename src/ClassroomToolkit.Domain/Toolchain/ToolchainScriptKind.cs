namespace ClassroomToolkit.Domain.Toolchain;

public enum ToolchainScriptKind
{
    Bootstrap = 0,
    Check = 1,
    Deliver = 2,
    AttachVisualDecision = 3,
    VerifyDeliveryDecisionAggregateAttachment = 4,
    AttachDeliveryDecisionAggregate = 5,
    ProjectReviewQueue = 6
}
