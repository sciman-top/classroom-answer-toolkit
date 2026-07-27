namespace ClassroomToolkit.Domain.Review;

public sealed record ReviewQueueProjectionRequest(IReadOnlyList<string> ArtifactPaths);
