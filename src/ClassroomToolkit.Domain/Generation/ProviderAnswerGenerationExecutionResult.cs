using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Generation;

public sealed record ProviderAnswerGenerationExecutionResult(
    ToolchainExecutionResult Execution,
    AnswerGenerationResult? Generation,
    string? AnswerMarkdownPath,
    string? ResultArtifactPath);
