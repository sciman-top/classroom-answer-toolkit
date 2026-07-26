namespace ClassroomToolkit.Domain.Delivery;

public sealed record DeliveryDecisionAggregateAttachmentRequest(
    string DeliveryManifestPath,
    string AggregatePath);
