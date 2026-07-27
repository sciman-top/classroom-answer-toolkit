namespace ClassroomToolkit.Domain.Review;

public sealed record ReviewQueueItem(
    string Queue,
    string ArtifactKind,
    string ArtifactId,
    string SubjectPack,
    string SourcePath,
    string SourceSha256,
    string Reason);
