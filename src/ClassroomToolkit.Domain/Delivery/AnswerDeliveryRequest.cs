namespace ClassroomToolkit.Domain.Delivery;

public sealed record AnswerDeliveryRequest(
    string AnswerMarkdownPath,
    string? OutputPdfPath,
    string Profile,
    bool KeepReviewArtifacts);
