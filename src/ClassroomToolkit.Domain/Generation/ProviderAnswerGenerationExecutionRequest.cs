namespace ClassroomToolkit.Domain.Generation;

public sealed record ProviderAnswerGenerationExecutionRequest(
    string RequestArtifactPath,
    string WorkspaceRoot,
    string OutputDirectoryPath,
    string ConfigEnvFilePath,
    bool AllowCloudEgress,
    int TimeoutMilliseconds = 30_000,
    int MaxOutputTokens = 4_096);
