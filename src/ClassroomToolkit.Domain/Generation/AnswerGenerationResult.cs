namespace ClassroomToolkit.Domain.Generation;

public sealed record AnswerGenerationResult(
    string RequestId,
    string SubjectPack,
    string SourceRequestSha256,
    string AnswerMarkdown,
    string CandidateArtifactRef,
    string RawAnswerSha256,
    AnswerGenerationDataClassification DataClassification,
    AnswerGenerationProvenance Provenance,
    string StopReason,
    AnswerGenerationDisposition? GenerationDisposition = null);
