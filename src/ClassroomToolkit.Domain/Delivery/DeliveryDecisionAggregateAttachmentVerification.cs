namespace ClassroomToolkit.Domain.Delivery;

public sealed record DeliveryDecisionAggregateAttachmentVerification(
    string ManifestPath,
    string AggregatePath,
    string PreimageBackupPath,
    string ReceiptPath,
    string AttachmentId,
    string ManifestPreimageSha256,
    string ManifestResultSha256,
    bool VisualReviewPassed,
    bool Trusted);
