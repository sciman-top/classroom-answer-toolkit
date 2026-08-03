using ClassroomToolkit.App.Services;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class HeadlessSmokeRunnerTests
{
    [Fact]
    public void RunReportsCoreWorkspaceState()
    {
        var result = new HeadlessSmokeRunner(new FakeOrchestrator()).Run();

        result.WorkspaceHealthy.Should().BeTrue();
        result.PrimarySubjectPack.Should().Be("junior-physics-answer");
        result.EvalOk.Should().BeTrue();
        result.EvalCaseCount.Should().Be(12);
    }

    private sealed class FakeOrchestrator : IToolchainOrchestrator
    {
        public ToolchainWorkspaceInfo GetWorkspaceInfo() => new(
            @"D:\repo", "bootstrap", "check", true, true, "junior-physics-answer", ["junior-physics-answer"]);
        public WorkspaceHealthReport GetWorkspaceHealthReport() => new(
            "junior-physics-answer", ["junior-physics-answer"], "v8.14", "v8.14", true, "snapshot.json",
            "v8.14", "classroom", true, true, 12, "主链就绪", []);
        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(AnswerDeliveryRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
