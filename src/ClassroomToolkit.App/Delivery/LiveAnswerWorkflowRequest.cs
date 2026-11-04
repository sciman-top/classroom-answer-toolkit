namespace ClassroomToolkit.App.Delivery;

public sealed record LiveAnswerWorkflowRequest(
    string SourcePdfPath,
    string OutputDirectory,
    string? ReferencePdfPath,
    string SubjectPack,
    string Profile,
    bool SkipVisualAudit,
    bool AllowCloudEgress,
    bool KeepReview,
    bool UseGatewayProxy);

public sealed record LiveAnswerWorkflowResult(
    string WorkflowReceiptPath,
    string AnswerMarkdownPath,
    string OutputPdfPath,
    string ManifestPath,
    string? ReviewDirectoryPath,
    string? SnapshotId);
