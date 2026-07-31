namespace ClassroomToolkit.Domain.Generation;

public sealed record AnswerGenerationDisposition(
    bool ReviewRequired,
    bool Trusted,
    string AcceptanceDisposition,
    string WorkflowDisposition);
