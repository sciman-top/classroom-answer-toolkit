using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
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
    public void ConstructorDegradesToFallbackPack_WhenWorkspaceScanThrows()
    {
        var viewModel = new MainViewModel(new FakeOrchestrator(throwOnWorkspaceInfo: true), new FakePathOpener());

        viewModel.SelectedSubjectPack.Should().Be("junior-physics-answer");
        viewModel.AvailableSubjectPacks.Should().ContainSingle().Which.Should().Be("junior-physics-answer");
        viewModel.ActivityLog.Should().Contain("工作区扫描失败");
        viewModel.StatusMessage.Should().Contain("健康检查失败");
    }

    [Fact]
    public void SelectingSubjectPackRefreshesItsHealthStatus()
    {
        var orchestrator = new FakeOrchestrator();
        var viewModel = new MainViewModel(orchestrator, new FakePathOpener());

        viewModel.SelectedSubjectPack = "math-answer";

        orchestrator.LastHealthSubjectPack.Should().Be("math-answer");
        viewModel.StatusCards[0].Detail.Should().Be("math-answer");
    }

    [Fact]
    public async Task SelectingAnotherSubjectPack_CancelsTheSupersededHealthProbe()
    {
        var orchestrator = new FakeOrchestrator(blockInitialHealth: true);
        using var viewModel = new MainViewModel(orchestrator, new FakePathOpener());
        await orchestrator.InitialHealthStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        viewModel.SelectedSubjectPack = "math-answer";

        await orchestrator.InitialHealthCanceled.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await orchestrator.LatestHealthCompleted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        orchestrator.LastHealthSubjectPack.Should().Be("math-answer");
        viewModel.StatusCards[0].Detail.Should().Be("math-answer");
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

            viewModel.StatusMessage.Should().Be("排版交付完成（rendered；不代表语义正确或教师验收）");
            viewModel.LastOutputPdfPath.Should().Be(@"D:\out\answer.pdf");
            orchestrator.LastDeliveryRequest.Should().NotBeNull();
        }
        finally
        {
            File.Delete(markdownPath);
        }
    }

    [Fact]
    public async Task CancelStopsTheCurrentToolchainOperation()
    {
        var orchestrator = new FakeOrchestrator(blockCheck: true);
        using var viewModel = new MainViewModel(orchestrator, new FakePathOpener());

        var checkTask = viewModel.CheckCommand.ExecuteAsync(null);
        await orchestrator.CheckStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        viewModel.CancelCommand.Execute(null);
        await checkTask;

        viewModel.IsBusy.Should().BeFalse();
        viewModel.StatusMessage.Should().Be("当前任务已取消");
    }

    [Fact]
    public async Task ActivityLogIsBoundedForLargeToolOutput()
    {
        var orchestrator = new FakeOrchestrator(checkOutput: new string('x', 100_000));
        using var viewModel = new MainViewModel(orchestrator, new FakePathOpener());

        await viewModel.CheckCommand.ExecuteAsync(null);

        viewModel.ActivityLog.Length.Should().BeLessThanOrEqualTo(64 * 1024);
    }

    private sealed class FakeOrchestrator : IToolchainOrchestrator
    {
        private readonly bool _blockCheck;
        private readonly string _checkOutput;
        private readonly bool _throwOnWorkspaceInfo;
        private readonly bool _blockInitialHealth;

        public FakeOrchestrator(
            bool blockCheck = false,
            string checkOutput = "ok",
            bool throwOnWorkspaceInfo = false,
            bool blockInitialHealth = false)
        {
            _blockCheck = blockCheck;
            _checkOutput = checkOutput;
            _throwOnWorkspaceInfo = throwOnWorkspaceInfo;
            _blockInitialHealth = blockInitialHealth;
        }

        public AnswerDeliveryRequest? LastDeliveryRequest { get; private set; }
        public string? LastHealthSubjectPack { get; private set; }
        public TaskCompletionSource CheckStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource InitialHealthStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource InitialHealthCanceled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource LatestHealthCompleted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public ToolchainWorkspaceInfo GetWorkspaceInfo()
        {
            if (_throwOnWorkspaceInfo)
            {
                throw new IOException("prompts 目录被占用");
            }

            return new(
                @"D:\repo", @"D:\repo\scripts\bootstrap.ps1", @"D:\repo\scripts\check-toolchain.ps1",
                true, true, "junior-physics-answer", ["junior-physics-answer", "math-answer"]);
        }

        public async Task<WorkspaceHealthReport> GetWorkspaceHealthReportAsync(
            string? subjectPack = null,
            CancellationToken cancellationToken = default)
        {
            if (_throwOnWorkspaceInfo)
            {
                throw new IOException("prompts 目录被占用");
            }

            LastHealthSubjectPack = subjectPack;
            var selected = subjectPack ?? "junior-physics-answer";
            if (_blockInitialHealth && string.Equals(selected, "junior-physics-answer", StringComparison.Ordinal))
            {
                InitialHealthStarted.TrySetResult();
                try
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    InitialHealthCanceled.TrySetResult();
                    throw;
                }
            }

            LatestHealthCompleted.TrySetResult();
            return new WorkspaceHealthReport(
                selected, ["junior-physics-answer", "math-answer"], "v8.14", "v8.14",
                true, @"D:\repo\.snapshot-cache\resolved-snapshot.json",
                true, 12, $"{selected} 主链就绪", []);
        }

        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Success(ToolchainScriptKind.Bootstrap));

        public async Task<ToolchainExecutionResult> RunCheckAsync(
            string? subjectPack = null,
            CancellationToken cancellationToken = default)
        {
            CheckStarted.TrySetResult();
            if (_blockCheck)
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }

            return ToolchainExecutionResult.Success(
                ToolchainScriptKind.Check,
                "tool",
                DateTimeOffset.Now,
                DateTimeOffset.Now,
                _checkOutput);
        }

        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
            AnswerDeliveryRequest request,
            CancellationToken cancellationToken = default)
        {
            LastDeliveryRequest = request;
            var delivery = new AnswerDeliveryResult(
                @"D:\out\answer.pdf", @"D:\out\answer.delivery-manifest.json",
                @"D:\repo\.pdf-review\answer", "snapshot-test", "junior-physics-answer");
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
