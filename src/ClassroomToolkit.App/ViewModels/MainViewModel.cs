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
    private const string FallbackSubjectPack = "junior-physics-answer";
    private readonly IToolchainOrchestrator _toolchainOrchestrator;
    private readonly IPathOpener _pathOpener;
    private readonly IUpdateService? _updateService;
    private readonly StringBuilder _activityLog = new();
    private CancellationTokenSource? _operationCancellation;
    private CancellationTokenSource? _healthRefreshCancellation;
    private bool _suppressHealthRefresh;
    private int _healthRefreshVersion;

    public MainViewModel(
        IToolchainOrchestrator toolchainOrchestrator,
        IPathOpener pathOpener,
        IUpdateService? updateService = null)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _pathOpener = pathOpener;
        _updateService = updateService;
        AvailableSubjectPacks = new ObservableCollection<string>();
        StatusCards = new ObservableCollection<StatusCardViewModel>();

        // A locked or damaged prompts/ tree must degrade to the default pack view
        // instead of crashing application startup.
        _suppressHealthRefresh = true;
        try
        {
            var workspace = _toolchainOrchestrator.GetWorkspaceInfo();
            foreach (var subjectPack in workspace.SubjectPacks)
            {
                AvailableSubjectPacks.Add(subjectPack);
            }
            SelectedSubjectPack = workspace.PrimarySubjectPack ?? DefaultSubjectPackFallback();
        }
        catch (Exception ex)
        {
            AppendLog($"工作区扫描失败：{ex.Message}");
            SelectedSubjectPack = DefaultSubjectPackFallback();
        }
        finally
        {
            _suppressHealthRefresh = false;
        }

        // The health check drives a real node process (up to the 2-minute guard);
        // it must never block UI construction, so it runs fire-and-forget and
        // updates the cards when it completes.
        _ = RefreshHealthAsync();
        _ = CheckForUpdatesAsync();
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
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallUpdateCommand))]
    private bool updateAvailable;
    [ObservableProperty] private string updateStatus = "未检查更新";
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallUpdateCommand))]
    private bool isUpdateBusy;
    private UpdateInfo? _availableUpdate;

    private string DefaultSubjectPackFallback()
    {
        if (AvailableSubjectPacks.Count == 0)
        {
            AvailableSubjectPacks.Add(FallbackSubjectPack);
        }
        return AvailableSubjectPacks[0];
    }

    private bool CanDeliver() => !IsBusy && File.Exists(SelectedAnswerMarkdownPath);
    private bool CanRunToolchain() => !IsBusy;
    private bool CanCancel() => IsBusy && _operationCancellation is { IsCancellationRequested: false };

    partial void OnSelectedSubjectPackChanged(string value)
    {
        if (!_suppressHealthRefresh)
        {
            _ = RefreshHealthAsync();
        }
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
            StatusMessage = "排版交付完成（rendered；不代表语义正确或教师验收）";
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

    [RelayCommand]
    private async Task CheckForUpdatesAsync()
    {
        if (_updateService is null)
        {
            UpdateStatus = "开发模式：未启用安装版更新检查";
            return;
        }

        try
        {
            UpdateStatus = "正在检查更新...";
            var result = await _updateService.CheckAsync();
            _availableUpdate = result.Update;
            UpdateAvailable = result.UpdateAvailable;
            UpdateStatus = result.Message;
        }
        catch (Exception ex)
        {
            UpdateAvailable = false;
            _availableUpdate = null;
            UpdateStatus = $"更新检查失败：{ex.Message}";
        }
    }

    [RelayCommand(CanExecute = nameof(CanInstallUpdate))]
    private async Task InstallUpdateAsync()
    {
        if (_updateService is null || _availableUpdate is null)
        {
            return;
        }

        IsUpdateBusy = true;
        try
        {
            var result = await _updateService.InstallAsync(_availableUpdate);
            UpdateStatus = result.Message;
            AppendLog(result.Message);
            if (result.Started)
            {
                System.Windows.Application.Current?.Shutdown(0);
            }
        }
        catch (Exception ex)
        {
            UpdateStatus = $"启动更新失败：{ex.Message}";
        }
        finally
        {
            IsUpdateBusy = false;
        }
    }

    private bool CanInstallUpdate() => UpdateAvailable && !IsUpdateBusy && !IsBusy;

    private async Task RunToolchainAsync(
        string message,
        Func<CancellationToken, Task<ToolchainExecutionResult>> action)
    {
        await RunAsync(message, async cancellationToken =>
        {
            var result = await action(cancellationToken);
            ApplyExecution(result);
            StatusMessage = result.Succeeded ? "工具链检查完成" : "工具链检查失败";
            await RefreshHealthAsync(cancellationToken);
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
            InstallUpdateCommand.NotifyCanExecuteChanged();
        }
    }

    private void ApplyExecution(ToolchainExecutionResult result)
    {
        LastResultSummary = $"{result.Kind}: exit {result.ExitCode}, {result.Duration.TotalSeconds:F1}s";
        AppendLog(result.Output);
    }

    // StatusMessage semantics (2026-08-27 product ruling): it always shows the
    // LATEST workspace health; the most recent operation result lives in
    // LastResultSummary and the activity log, so a successful health refresh
    // overwriting a toolchain verdict is intentional.
    private async Task RefreshHealthAsync(CancellationToken cancellationToken = default)
    {
        // A health probe starts a real Node process.  Versioning protects the UI
        // from stale results, but cancelling the superseded probe protects the
        // machine from doing up to two minutes of unnecessary work per switch.
        var refreshCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previousRefresh = Interlocked.Exchange(ref _healthRefreshCancellation, refreshCancellation);
        previousRefresh?.Cancel();
        var version = Interlocked.Increment(ref _healthRefreshVersion);
        try
        {
            var health = await _toolchainOrchestrator
                .GetWorkspaceHealthReportAsync(SelectedSubjectPack, refreshCancellation.Token);
            if (version != _healthRefreshVersion)
            {
                return;
            }

            StatusMessage = health.IsHealthy ? "答案生成与排版主链已就绪" : health.Summary;
            StatusCards.Clear();
            StatusCards.Add(new StatusCardViewModel("Subject Packs", health.SubjectPacks.Count.ToString(), health.PrimarySubjectPack ?? "未发现", health.SubjectPacks.Count > 0));
            StatusCards.Add(new StatusCardViewModel("Snapshot", health.SnapshotExists ? "Ready" : "Missing", health.SnapshotPath, health.SnapshotExists));
            StatusCards.Add(new StatusCardViewModel("Regression", health.EvalOk ? "Passed" : "Pending", $"{health.EvalCaseCount} cases", health.EvalOk));
            StatusCards.Add(new StatusCardViewModel("Prompt", health.AssetVersion ?? "Unknown", health.LatestProductionSpecVersion ?? "未发现", health.AssetVersion == health.LatestProductionSpecVersion));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException) when (refreshCancellation.IsCancellationRequested)
        {
            // A newer subject-pack selection already owns the health surface.
        }
        catch (Exception ex)
        {
            if (version != _healthRefreshVersion)
            {
                return;
            }

            // Keep the previous status cards visible and surface the failure as a diagnostic.
            StatusMessage = $"工作区健康检查失败：{ex.Message}";
        }
        finally
        {
            Interlocked.CompareExchange(ref _healthRefreshCancellation, null, refreshCancellation);
        }
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
        _healthRefreshCancellation?.Cancel();
    }
}
