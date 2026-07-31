using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainViewModelTests
{
    [Fact]
    public void ConstructorPrefersJuniorPhysicsPack()
    {
        var viewModel = new MainViewModel(new FakeOrchestrator(), new FakePathOpener());

        viewModel.SelectedSubjectPack.Should().Be("junior-physics-answer");
        viewModel.StatusMessage.Should().Contain("主链");
    }

    [Fact]
    public async Task DeliverUpdatesOutputArtifacts()
    {
        var markdownPath = Path.GetTempFileName();
        try
        {
            var orchestrator = new FakeOrchestrator();
            var viewModel = new MainViewModel(orchestrator, new FakePathOpener())
            {
                SelectedAnswerMarkdownPath = markdownPath,
                SelectedOutputPdfPath = @"D:\out\answer.pdf"
            };

            await viewModel.DeliverCommand.ExecuteAsync(null);

            viewModel.StatusMessage.Should().Be("答案交付完成");
            viewModel.LastOutputPdfPath.Should().Be(@"D:\out\answer.pdf");
            orchestrator.LastDeliveryRequest.Should().NotBeNull();
        }
        finally
        {
            File.Delete(markdownPath);
        }
    }

    private sealed class FakeOrchestrator : IToolchainOrchestrator
    {
        public AnswerDeliveryRequest? LastDeliveryRequest { get; private set; }

        public ToolchainWorkspaceInfo GetWorkspaceInfo() => new(
            @"D:\repo", @"D:\repo\scripts\bootstrap.ps1", @"D:\repo\scripts\check-toolchain.ps1",
            true, true, "junior-physics-answer", ["junior-physics-answer", "math-answer"]);

        public WorkspaceHealthReport GetWorkspaceHealthReport() => new(
            "junior-physics-answer", ["junior-physics-answer", "math-answer"], "v8.14", "v8.14",
            true, @"D:\repo\.snapshot-cache\resolved-snapshot.json", "v8.14", "classroom",
            true, true, 12, "主链就绪", []);

        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Success(ToolchainScriptKind.Bootstrap));

        public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Success(ToolchainScriptKind.Check));

        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
            AnswerDeliveryRequest request,
            CancellationToken cancellationToken = default)
        {
            LastDeliveryRequest = request;
            var delivery = new AnswerDeliveryResult(
                request.AnswerMarkdownPath, @"D:\out\answer.pdf", @"D:\out\answer.delivery-manifest.json",
                @"D:\repo\.pdf-review\answer", "snapshot-test", "junior-physics-answer", "classroom",
                @"D:\repo\.snapshot-cache\resolved-snapshot.json", "v8.14")
            { ReviewLifecycleState = "ready_for_review" };
            return Task.FromResult<(ToolchainExecutionResult, AnswerDeliveryResult?)>((Success(ToolchainScriptKind.Deliver), delivery));
        }

        private static ToolchainExecutionResult Success(ToolchainScriptKind kind) =>
            ToolchainExecutionResult.Success(kind, "tool", DateTimeOffset.Now, DateTimeOffset.Now, "ok");
    }

    private sealed class FakePathOpener : IPathOpener
    {
        public bool TryOpenPath(string path, out string? errorMessage)
        {
            errorMessage = null;
            return true;
        }
    }
}
