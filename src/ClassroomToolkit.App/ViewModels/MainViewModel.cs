using System.Collections.ObjectModel;
using System.IO;
using System.Text;
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
    private readonly StringBuilder _activityLog = new();
    private WorkspaceHealthReport _healthReport;

    public MainViewModel(IToolchainOrchestrator toolchainOrchestrator)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        StatusCards = new ObservableCollection<StatusCardViewModel>();
        Issues = new ObservableCollection<string>();

        var workspaceInfo = _toolchainOrchestrator.GetWorkspaceInfo();
        RepositoryRoot = workspaceInfo.RepositoryRoot;
        BootstrapScriptPath = workspaceInfo.BootstrapScriptPath;
        CheckScriptPath = workspaceInfo.CheckScriptPath;
        WorkspaceSummary = workspaceInfo.Summary;
        SelectedProfile = "classroom";

        _healthReport = _toolchainOrchestrator.GetWorkspaceHealthReport();
        StatusMessage = _healthReport.IsHealthy ? "工作区规则链已就绪" : "工作区仍有待处理项";
        LastResultSummary = "等待操作";

        RefreshHealthPresentation();
    }

    [ObservableProperty]
    private string repositoryRoot = string.Empty;

    [ObservableProperty]
    private string bootstrapScriptPath = string.Empty;

    [ObservableProperty]
    private string checkScriptPath = string.Empty;

    [ObservableProperty]
    private string workspaceSummary = string.Empty;

    [ObservableProperty]
    private string statusMessage = string.Empty;

    [ObservableProperty]
    private string lastResultSummary = string.Empty;

    [ObservableProperty]
    private string activityLog = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DeliverCommand))]
    private string selectedAnswerMarkdownPath = string.Empty;

    [ObservableProperty]
    private string selectedOutputPdfPath = string.Empty;

    [ObservableProperty]
    private string selectedProfile = "classroom";

    [ObservableProperty]
    private bool keepReviewArtifacts = true;

    [ObservableProperty]
    private string lastOutputPdfPath = string.Empty;

    [ObservableProperty]
    private string lastDeliveryManifestPath = string.Empty;

    [ObservableProperty]
    private string lastReviewDirectoryPath = string.Empty;

    public ObservableCollection<StatusCardViewModel> StatusCards { get; }

    public ObservableCollection<string> Issues { get; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(BootstrapCommand))]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand))]
    [NotifyCanExecuteChangedFor(nameof(BrowseAnswerMarkdownCommand))]
    [NotifyCanExecuteChangedFor(nameof(DeliverCommand))]
    private bool isBusy;

    private bool CanRunActions() => !IsBusy;

    private bool CanDeliver() => !IsBusy && !string.IsNullOrWhiteSpace(SelectedAnswerMarkdownPath);

    [RelayCommand(CanExecute = nameof(CanRunActions))]
    private void BrowseAnswerMarkdown()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "选择参考答案 Markdown",
            Filter = "Markdown 文件 (*.md)|*.md",
            InitialDirectory = Directory.Exists(Path.Combine(RepositoryRoot, "习题PDF"))
                ? Path.Combine(RepositoryRoot, "习题PDF")
                : RepositoryRoot
        };

        if (dialog.ShowDialog() == true)
        {
            SelectedAnswerMarkdownPath = dialog.FileName;
            SelectedOutputPdfPath = Path.ChangeExtension(dialog.FileName, ".pdf");
        }
    }

    [RelayCommand(CanExecute = nameof(CanRunActions))]
    private async Task BootstrapAsync()
    {
        await RunToolchainScriptAsync("初始化工具链", ct => _toolchainOrchestrator.RunBootstrapAsync(ct));
    }

    [RelayCommand(CanExecute = nameof(CanRunActions))]
    private async Task CheckAsync()
    {
        await RunToolchainScriptAsync("执行体检", ct => _toolchainOrchestrator.RunCheckAsync(ct));
    }

    [RelayCommand(CanExecute = nameof(CanDeliver))]
    private async Task DeliverAsync()
    {
        IsBusy = true;
        StatusMessage = "执行答案交付中...";
        AppendSectionTitle("执行答案交付");

        try
        {
            var request = new AnswerDeliveryRequest(
                SelectedAnswerMarkdownPath,
                string.IsNullOrWhiteSpace(SelectedOutputPdfPath) ? null : SelectedOutputPdfPath,
                string.IsNullOrWhiteSpace(SelectedProfile) ? "classroom" : SelectedProfile,
                KeepReviewArtifacts);

            var (execution, delivery) = await _toolchainOrchestrator.RunDeliverAsync(request);
            AppendExecution("答案交付", execution);

            if (delivery is not null)
            {
                LastOutputPdfPath = delivery.OutputPdfPath;
                LastDeliveryManifestPath = delivery.DeliveryManifestPath;
                LastReviewDirectoryPath = delivery.ReviewDirectoryPath;

                AppendLine(string.Empty);
                AppendLine("交付产物:");
                AppendLine($"- PDF: {delivery.OutputPdfPath}");
                AppendLine($"- Delivery Manifest: {delivery.DeliveryManifestPath}");
                AppendLine($"- Review Directory: {delivery.ReviewDirectoryPath}");
            }

            StatusMessage = execution.Succeeded ? "答案交付完成" : "答案交付失败";
            LastResultSummary = $"答案交付 · 退出码 {execution.ExitCode} · {execution.Duration.TotalSeconds:0.0}s";
            RefreshHealthPresentation(appendLog: false);
        }
        catch (Exception ex)
        {
            AppendLine(ex.Message);
            StatusMessage = "答案交付异常";
            LastResultSummary = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task RunToolchainScriptAsync(
        string title,
        Func<CancellationToken, Task<ToolchainExecutionResult>> action)
    {
        IsBusy = true;
        StatusMessage = $"{title} 进行中...";
        AppendSectionTitle(title);

        try
        {
            var result = await action(CancellationToken.None);
            AppendExecution(title, result);
            StatusMessage = result.Succeeded ? $"{title} 完成" : $"{title} 失败";
            LastResultSummary = $"{title} · 退出码 {result.ExitCode} · {result.Duration.TotalSeconds:0.0}s";
            RefreshHealthPresentation(appendLog: false);
        }
        catch (Exception ex)
        {
            AppendLine(ex.Message);
            StatusMessage = $"{title} 异常";
            LastResultSummary = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void RefreshHealthPresentation(bool appendLog = true)
    {
        _healthReport = _toolchainOrchestrator.GetWorkspaceHealthReport();

        StatusCards.Clear();
        StatusCards.Add(new StatusCardViewModel(
            "最新规范",
            _healthReport.LatestProductionSpecVersion ?? "未知",
            $"资产版本 {_healthReport.AssetVersion ?? "未知"}",
            _healthReport.LatestProductionSpecVersion == _healthReport.AssetVersion));
        StatusCards.Add(new StatusCardViewModel(
            "默认快照",
            _healthReport.SnapshotExists ? (_healthReport.SnapshotVersion ?? "未知") : "缺失",
            _healthReport.SnapshotExists
                ? $"配置 {_healthReport.SnapshotProfile ?? "未知"}"
                : "尚未生成 classroom 快照",
            _healthReport.SnapshotExists));
        StatusCards.Add(new StatusCardViewModel(
            "固定回归",
            _healthReport.EvalExists ? (_healthReport.EvalOk ? "通过" : "失败") : "缺失",
            _healthReport.EvalExists ? $"共 {_healthReport.EvalCaseCount} 组" : "尚未生成 latest.json",
            _healthReport.EvalExists && _healthReport.EvalOk));

        Issues.Clear();
        foreach (var issue in _healthReport.Issues)
        {
            Issues.Add(issue);
        }

        if (!appendLog)
        {
            return;
        }

        AppendLine("工作区已加载。");
        AppendLine($"仓库根目录: {RepositoryRoot}");
        AppendLine($"Bootstrap 脚本: {BootstrapScriptPath}");
        AppendLine($"Check 脚本: {CheckScriptPath}");
        AppendLine($"工作区状态: {WorkspaceSummary}");
        AppendLine($"规范 / 资产: {_healthReport.LatestProductionSpecVersion ?? "未知"} / {_healthReport.AssetVersion ?? "未知"}");
        AppendLine($"快照: {(_healthReport.SnapshotExists ? $"{_healthReport.SnapshotVersion} / {_healthReport.SnapshotProfile}" : "缺失")}");
        AppendLine($"回归: {(_healthReport.EvalExists ? $"{(_healthReport.EvalOk ? "通过" : "失败")} / {_healthReport.EvalCaseCount} 组" : "缺失")}");

        if (_healthReport.Issues.Count > 0)
        {
            AppendLine("待处理项:");
            foreach (var issue in _healthReport.Issues)
            {
                AppendLine($"- {issue}");
            }
        }
    }

    private void AppendExecution(string title, ToolchainExecutionResult result)
    {
        AppendLine($"脚本: {result.ScriptPath}");
        AppendLine($"退出码: {result.ExitCode}");
        AppendLine($"耗时: {result.Duration.TotalSeconds:0.0}s");

        var output = result.Output.Trim();
        if (!string.IsNullOrWhiteSpace(output))
        {
            AppendLine(string.Empty);
            AppendLine(output);
        }

        if (!result.Succeeded)
        {
            AppendLine(string.Empty);
            AppendLine($"{title} 未成功完成。");
        }
    }

    private void AppendSectionTitle(string title)
    {
        AppendLine(string.Empty);
        AppendLine($"=== {title} ===");
    }

    private void AppendLine(string line)
    {
        if (_activityLog.Length > 0)
        {
            _activityLog.AppendLine();
        }

        _activityLog.Append(line);
        ActivityLog = _activityLog.ToString();
    }
}
