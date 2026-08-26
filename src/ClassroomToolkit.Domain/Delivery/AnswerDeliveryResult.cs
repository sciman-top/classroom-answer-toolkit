namespace ClassroomToolkit.Domain.Delivery;

public sealed record AnswerDeliveryResult(
    string OutputPdfPath,
    string DeliveryManifestPath,
    string ReviewDirectoryPath,
    string? SnapshotId,
    string SubjectPack);
