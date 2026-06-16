namespace ClassroomToolkit.Domain.Delivery;

public sealed record AnswerDeliveryResult(
    string AnswerMarkdownPath,
    string OutputPdfPath,
    string DeliveryManifestPath,
    string ReviewDirectoryPath);
