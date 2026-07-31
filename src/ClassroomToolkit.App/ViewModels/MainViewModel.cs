using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;

namespace ClassroomToolkit.App.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly IToolchainOrchestrator _toolchainOrchestrator;
    private readonly IPathOpener _pathOpener;
    private readonly StringBuilder _activityLog = new();

    public MainViewModel(IToolchainOrchestrator toolchainOrchestrator, IPathOpener pathOpener)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _pathOpener = pathOpener;
        AvailableSubjectPacks = new ObservableCollection<string>();
        StatusCards = new ObservableCollection<StatusCardViewModel>();
        Issues = new ObservableCollection<string>();

        var workspace = _toolchainOrchestrator.GetWorkspaceInfo();
        RepositoryRoot = workspace.RepositoryRoot;
        WorkspaceSummary = workspace.Summary;
        BootstrapScriptPath = workspace.BootstrapScriptPath;
        CheckScriptPath = workspace.CheckScriptPath;
        foreach (var subjectPack in workspace.SubjectPacks)
        {
            AvailableSubjectPacks.Add(subjectPack);
        }
        if (AvailableSubjectPacks.Count == 0)
        {
            AvailableSubjectPacks.Add("junior-physics-answer");
        }
        SelectedSubjectPack = workspace.PrimarySubjectPack ?? AvailableSubjectPacks[0];

        RefreshHealth();
    }

    public ObservableCollection<string> AvailableSubjectPacks { get; }
    public ObservableCollection<StatusCardViewModel> StatusCards { get; }
    public ObservableCollection<string> Issues { get; }

    [ObservableProperty] private string repositoryRoot = string.Empty;
    [ObservableProperty] private string workspaceSummary = string.Empty;
    [ObservableProperty] private string bootstrapScriptPath = string.Empty;
    [ObservableProperty] private string checkScriptPath = string.Empty;
    [ObservableProperty] private string statusMessage = string.Empty;
    [ObservableProperty] private string lastResultSummary = "等待操作";
    [ObservableProperty] private string activityLog = string.Empty;
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DeliverCommand))]
    private string selectedAnswerMarkdownPath = string.Empty;
    [ObservableProperty] private string selectedOutputPdfPath = string.Empty;
    [ObservableProperty] private string selectedSubjectPack = "junior-physics-answer";
    [ObservableProperty] private string selectedProfile = "classroom";
    [ObservableProperty] private bool keepReviewArtifacts = true;
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DeliverCommand))]
    [NotifyCanExecuteChangedFor(nameof(BootstrapCommand))]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand))]
    private bool isBusy;
    [ObservableProperty] private string lastOutputPdfPath = string.Empty;
    [ObservableProperty] private string lastDeliveryManifestPath = string.Empty;
    [ObservableProperty] private string lastReviewDirectoryPath = string.Empty;
    [ObservableProperty] private string lastSnapshotId = string.Empty;
    [ObservableProperty] private string lastDeliverySnapshotPath = string.Empty;
    [ObservableProperty] private string lastDeliverySnapshotVersion = string.Empty;
    [ObservableProperty] private string lastReviewLifecycleState = string.Empty;

    private bool CanDeliver() => !IsBusy && File.Exists(SelectedAnswerMarkdownPath);
    private bool CanRunToolchain() => !IsBusy;

    [RelayCommand]
    private void BrowseAnswerMarkdown()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "选择答案 Markdown",
            Filter = "Markdown (*.md)|*.md|所有文件 (*.*)|*.*"
        };
        if (dialog.ShowDialog() == true)
        {
            SelectedAnswerMarkdownPath = dialog.FileName;
            if (string.IsNullOrWhiteSpace(SelectedOutputPdfPath))
            {
                SelectedOutputPdfPath = Path.ChangeExtension(dialog.FileName, ".pdf");
            }
        }
    }

    [RelayCommand(CanExecute = nameof(CanDeliver))]
    private async Task DeliverAsync()
    {
        await RunAsync("正在生成排版答案 PDF...", async () =>
        {
            var (execution, delivery) = await _toolchainOrchestrator.RunDeliverAsync(
                new AnswerDeliveryRequest(
                    SelectedAnswerMarkdownPath,
                    string.IsNullOrWhiteSpace(SelectedOutputPdfPath) ? null : SelectedOutputPdfPath,
                    SelectedProfile,
                    KeepReviewArtifacts,
                    SelectedSubjectPack));
            ApplyExecution(execution);
            if (!execution.Succeeded || delivery is null)
            {
                StatusMessage = "答案交付失败";
                return;
            }

            LastOutputPdfPath = delivery.OutputPdfPath;
            LastDeliveryManifestPath = delivery.DeliveryManifestPath;
            LastReviewDirectoryPath = delivery.ReviewDirectoryPath;
            LastSnapshotId = delivery.SnapshotId ?? string.Empty;
            LastDeliverySnapshotPath = delivery.SnapshotPath;
            LastDeliverySnapshotVersion = delivery.SnapshotVersion ?? string.Empty;
            LastReviewLifecycleState = delivery.ReviewLifecycleState ?? string.Empty;
            StatusMessage = "答案交付完成";
        });
    }

    [RelayCommand(CanExecute = nameof(CanRunToolchain))]
    private async Task BootstrapAsync()
    {
        await RunToolchainAsync("正在安装或修复工具链...", _toolchainOrchestrator.RunBootstrapAsync);
    }

    [RelayCommand(CanExecute = nameof(CanRunToolchain))]
    private async Task CheckAsync()
    {
        await RunToolchainAsync("正在执行主链体检...", _toolchainOrchestrator.RunCheckAsync);
    }

    [RelayCommand] private void OpenLastOutputPdf() => OpenPath(LastOutputPdfPath);
    [RelayCommand] private void OpenLastDeliveryManifest() => OpenPath(LastDeliveryManifestPath);
    [RelayCommand] private void OpenLastReviewDirectory() => OpenPath(LastReviewDirectoryPath);

    private async Task RunToolchainAsync(
        string message,
        Func<CancellationToken, Task<ToolchainExecutionResult>> action)
    {
        await RunAsync(message, async () =>
        {
            var result = await action(CancellationToken.None);
            ApplyExecution(result);
            StatusMessage = result.Succeeded ? "工具链检查完成" : "工具链检查失败";
            RefreshHealth();
        });
    }

    private async Task RunAsync(string message, Func<Task> action)
    {
        IsBusy = true;
        StatusMessage = message;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            StatusMessage = "执行失败";
            AppendLog(ex.ToString());
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void ApplyExecution(ToolchainExecutionResult result)
    {
        LastResultSummary = $"{result.Kind}: exit {result.ExitCode}, {result.Duration.TotalSeconds:F1}s";
        AppendLog(result.Output);
    }

    private void RefreshHealth()
    {
        var health = _toolchainOrchestrator.GetWorkspaceHealthReport();
        StatusMessage = health.IsHealthy ? "答案生成与排版主链已就绪" : "主链仍有待处理项";
        Issues.Clear();
        foreach (var issue in health.Issues)
        {
            Issues.Add(issue);
        }
        StatusCards.Clear();
        StatusCards.Add(new StatusCardViewModel("Subject Packs", health.SubjectPacks.Count.ToString(), health.PrimarySubjectPack ?? "未发现", health.SubjectPacks.Count > 0));
        StatusCards.Add(new StatusCardViewModel("Snapshot", health.SnapshotExists ? "Ready" : "Missing", health.SnapshotPath, health.SnapshotExists));
        StatusCards.Add(new StatusCardViewModel("Regression", health.EvalOk ? "Passed" : "Pending", $"{health.EvalCaseCount} cases", health.EvalOk));
        StatusCards.Add(new StatusCardViewModel("Prompt", health.AssetVersion ?? "Unknown", health.LatestProductionSpecVersion ?? "未发现", health.AssetVersion == health.LatestProductionSpecVersion));
    }

    private void OpenPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            StatusMessage = "没有可打开的路径";
            return;
        }
        if (!_pathOpener.TryOpenPath(path, out var error))
        {
            StatusMessage = error ?? "无法打开路径";
        }
    }

    private void AppendLog(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }
        _activityLog.AppendLine(text.Trim());
        ActivityLog = _activityLog.ToString();
    }
}
