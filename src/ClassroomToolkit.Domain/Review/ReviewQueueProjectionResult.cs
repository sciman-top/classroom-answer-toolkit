using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Domain.Review;

public sealed record ReviewQueueProjectionResult(
    ToolchainExecutionResult Execution,
    ReviewQueueProjection? Projection);
