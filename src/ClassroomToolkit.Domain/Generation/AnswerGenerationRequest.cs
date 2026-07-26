namespace ClassroomToolkit.Domain.Generation;

public sealed record AnswerGenerationRequest(
    string RequestId,
    string SubjectPack,
    string ProblemArtifactRef,
    string ProblemArtifactSha256,
    AnswerGenerationDataClassification DataClassification);
