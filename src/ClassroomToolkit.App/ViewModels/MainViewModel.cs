using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Win32;

namespace ClassroomToolkit.App.ViewModels;

public partial class MainViewModel : ObservableObject, IDisposable
{
    private const int MaxActivityLogCharacters = 64 * 1024;
    private readonly IToolchainOrchestrator _toolchainOrchestrator;
    private readonly IPathOpener _pathOpener;
    private readonly StringBuilder _activityLog = new();
    private CancellationTokenSource? _operationCancellation;

    public MainViewModel(IToolchainOrchestrator toolchainOrchestrator, IPathOpener pathOpener)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _pathOpener = pathOpener;
        AvailableSubjectPacks = new ObservableCollection<string>();
        StatusCards = new ObservableCollection<StatusCardViewModel>();

        var workspace = _toolchainOrchestrator.GetWorkspaceInfo();
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
    [NotifyCanExecuteChangedFor(nameof(CancelCommand))]
    private bool isBusy;
    [ObservableProperty] private string lastOutputPdfPath = string.Empty;
    [ObservableProperty] private string lastDeliveryManifestPath = string.Empty;
    [ObservableProperty] private string lastReviewDirectoryPath = string.Empty;
    [ObservableProperty] private string lastSnapshotId = string.Empty;

    private bool CanDeliver() => !IsBusy && File.Exists(SelectedAnswerMarkdownPath);
    private bool CanRunToolchain() => !IsBusy;
    private bool CanCancel() => IsBusy && _operationCancellation is { IsCancellationRequested: false };

    partial void OnSelectedSubjectPackChanged(string value)
    {
        RefreshHealth();
    }

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
        await RunAsync("正在生成排版答案 PDF...", async cancellationToken =>
        {
            var (execution, delivery) = await _toolchainOrchestrator.RunDeliverAsync(
                new AnswerDeliveryRequest(
                    SelectedAnswerMarkdownPath,
                    string.IsNullOrWhiteSpace(SelectedOutputPdfPath) ? null : SelectedOutputPdfPath,
                    SelectedProfile,
                    KeepReviewArtifacts,
                    SelectedSubjectPack),
                cancellationToken);
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
        await RunToolchainAsync(
            "正在执行主链体检...",
            cancellationToken => _toolchainOrchestrator.RunCheckAsync(SelectedSubjectPack, cancellationToken));
    }

    [RelayCommand] private void OpenLastOutputPdf() => OpenPath(LastOutputPdfPath);
    [RelayCommand] private void OpenLastDeliveryManifest() => OpenPath(LastDeliveryManifestPath);
    [RelayCommand] private void OpenLastReviewDirectory() => OpenPath(LastReviewDirectoryPath);

    private async Task RunToolchainAsync(
        string message,
        Func<CancellationToken, Task<ToolchainExecutionResult>> action)
    {
        await RunAsync(message, async cancellationToken =>
        {
            var result = await action(cancellationToken);
            ApplyExecution(result);
            StatusMessage = result.Succeeded ? "工具链检查完成" : "工具链检查失败";
            RefreshHealth();
        });
    }

    [RelayCommand(CanExecute = nameof(CanCancel))]
    private void Cancel()
    {
        if (_operationCancellation is not { IsCancellationRequested: false } cancellation)
        {
            return;
        }

        StatusMessage = "正在取消当前任务...";
        cancellation.Cancel();
        CancelCommand.NotifyCanExecuteChanged();
    }

    private async Task RunAsync(string message, Func<CancellationToken, Task> action)
    {
        using var cancellation = new CancellationTokenSource();
        _operationCancellation = cancellation;
        IsBusy = true;
        StatusMessage = message;
        try
        {
            await action(cancellation.Token);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            StatusMessage = "当前任务已取消";
            AppendLog("Operation canceled by user.");
        }
        catch (Exception ex)
        {
            StatusMessage = "执行失败";
            AppendLog(ex.ToString());
        }
        finally
        {
            if (ReferenceEquals(_operationCancellation, cancellation))
            {
                _operationCancellation = null;
            }
            IsBusy = false;
            CancelCommand.NotifyCanExecuteChanged();
        }
    }

    private void ApplyExecution(ToolchainExecutionResult result)
    {
        LastResultSummary = $"{result.Kind}: exit {result.ExitCode}, {result.Duration.TotalSeconds:F1}s";
        AppendLog(result.Output);
    }

    private void RefreshHealth()
    {
        var health = _toolchainOrchestrator.GetWorkspaceHealthReport(SelectedSubjectPack);
        StatusMessage = health.IsHealthy ? "答案生成与排版主链已就绪" : health.Summary;
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

        var normalized = text.Trim();
        if (normalized.Length > MaxActivityLogCharacters)
        {
            normalized = normalized[^MaxActivityLogCharacters..];
        }

        _activityLog.AppendLine(normalized);
        if (_activityLog.Length > MaxActivityLogCharacters)
        {
            _activityLog.Remove(0, _activityLog.Length - MaxActivityLogCharacters);
        }
        ActivityLog = _activityLog.ToString();
    }

    public void Dispose()
    {
        _operationCancellation?.Cancel();
    }
}
