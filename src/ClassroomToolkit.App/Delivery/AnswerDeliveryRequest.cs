namespace ClassroomToolkit.App.Delivery;

public sealed record AnswerDeliveryRequest(
    string AnswerMarkdownPath,
    string? OutputPdfPath,
    string Profile,
    bool KeepReviewArtifacts,
    string? SubjectPack = null);
