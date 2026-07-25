namespace ClassroomToolkit.Domain.Delivery;

public sealed record VisualDecisionAttachmentRequest(
    string DeliveryManifestPath,
    string DecisionRecordPath);
