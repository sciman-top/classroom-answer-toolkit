namespace ClassroomToolkit.Domain.Review;

public sealed record ReviewQueueProjection(
    bool Succeeded,
    string Authority,
    int SourceCount,
    int NeedsHumanLabelCount,
    int HighRiskApprovalCount,
    int TruthNeedsReviewCount,
    IReadOnlyList<ReviewQueueItem> Items,
    IReadOnlyList<ReviewQueueRejectedSource> RejectedSources);
