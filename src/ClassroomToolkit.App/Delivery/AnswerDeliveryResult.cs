namespace ClassroomToolkit.App.Delivery;

public sealed record AnswerDeliveryResult(
    string OutputPdfPath,
    string DeliveryManifestPath,
    string ReviewDirectoryPath,
    string? SnapshotId,
    string SubjectPack);
