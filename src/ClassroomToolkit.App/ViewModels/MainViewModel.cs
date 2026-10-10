using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Threading;
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
    // Captured on the constructing (UI) thread: toolchain progress lines arrive
    // on thread-pool threads and must be marshaled before touching bound state.
    private readonly SynchronizationContext? _creationContext;
    private CancellationTokenSource? _operationCancellation;
    private CancellationTokenSource? _healthRefreshCancellation;
    private bool _suppressHealthRefresh;
    private int _healthRefreshVersion;
    private int _updateCheckInFlight;

    public MainViewModel(
        IToolchainOrchestrator toolchainOrchestrator,
        IPathOpener pathOpener,
        IUpdateService? updateService = null)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
        _pathOpener = pathOpener;
        _updateService = updateService;
        _creationContext = SynchronizationContext.Current;
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
        SafeFireAndForget(() => RefreshHealthAsync(), "工作区健康检查");
        SafeFireAndForget(() => CheckForUpdatesAsync(), "更新检查");
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
    [NotifyCanExecuteChangedFor(nameof(CancelCommand))]
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

    // File.Exists is deliberately absent here: with UpdateSourceTrigger=
    // PropertyChanged it would hit the disk (possibly a disconnected drive,
    // blocking for seconds) on every keystroke. Existence is validated once
    // when the command actually runs.
    private bool CanDeliver() => !IsBusy && !string.IsNullOrWhiteSpace(SelectedAnswerMarkdownPath);
    private bool CanRunToolchain() => !IsBusy;
    private bool CanCancel()
        => (_operationCancellation is { IsCancellationRequested: false })
            || (IsUpdateBusy && InstallUpdateCommand.IsRunning);

    partial void OnSelectedSubjectPackChanged(string value)
    {
        if (!_suppressHealthRefresh)
        {
            SafeFireAndForget(() => RefreshHealthAsync(), "工作区健康检查");
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
        await RunAsync("正在生成排版答案 PDF...", async (cancellationToken, progress) =>
        {
            var (execution, delivery) = await _toolchainOrchestrator.RunDeliverAsync(
                new AnswerDeliveryRequest(
                    SelectedAnswerMarkdownPath,
                    string.IsNullOrWhiteSpace(SelectedOutputPdfPath) ? null : SelectedOutputPdfPath,
                    SelectedProfile,
                    KeepReviewArtifacts,
                    SelectedSubjectPack),
                cancellationToken,
                progress);
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
        await RunToolchainAsync("正在安装或修复工具链...", (cancellationToken, progress) =>
            _toolchainOrchestrator.RunBootstrapAsync(cancellationToken, progress));
    }

    [RelayCommand(CanExecute = nameof(CanRunToolchain))]
    private async Task CheckAsync()
    {
        await RunAsync("正在执行主链体检...", async (cancellationToken, progress) =>
        {
            var (result, healthReport) = await _toolchainOrchestrator
                .RunCheckAsync(SelectedSubjectPack, cancellationToken, progress);
            ApplyExecution(result);
            StatusMessage = result.Succeeded ? "工具链检查完成" : "工具链检查失败";
            if (healthReport is not null)
            {
                // A packaged runtime's check IS the health probe; reusing its
                // report spares a second Node cold start on every check.
                ApplyHealthReport(healthReport);
            }
            else
            {
                await RefreshHealthAsync(cancellationToken);
            }
        });
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

        // Startup fires one check and the button can fire more; without this
        // guard concurrent checks race and the last writer wins the status.
        if (Interlocked.Exchange(ref _updateCheckInFlight, 1) == 1)
        {
            return;
        }

        try
        {
            UpdateStatus = "正在检查更新...";
            // CheckAsync's contract is to translate expected failures into an
            // Unavailable result and never throw unless cancellation was asked
            // for; this catch is a last-resort guard for contract violations
            // only, so the UI can never crash from a failed update check.
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
        finally
        {
            Interlocked.Exchange(ref _updateCheckInFlight, 0);
        }
    }

    [RelayCommand(CanExecute = nameof(CanInstallUpdate))]
    private async Task InstallUpdateAsync(CancellationToken cancellationToken)
    {
        if (_updateService is null || _availableUpdate is null)
        {
            return;
        }

        IsUpdateBusy = true;
        try
        {
            // The update package can be a large download; honour cancellation so
            // the Cancel button and window shutdown can stop it.
            var result = await _updateService.InstallAsync(_availableUpdate, cancellationToken);
            UpdateStatus = result.Message;
            AppendLog(result.Message);
            if (result.Started)
            {
                System.Windows.Application.Current?.Shutdown(0);
            }
        }
        catch (OperationCanceledException)
        {
            UpdateStatus = "已取消更新下载";
        }
        // InstallAsync catches its own expected failures into the result; this
        // guard only keeps unexpected contract violations from crashing the app.
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
        Func<CancellationToken, Action<string>, Task<ToolchainExecutionResult>> action)
    {
        await RunAsync(message, async (cancellationToken, progress) =>
        {
            var result = await action(cancellationToken, progress);
            ApplyExecution(result);
            StatusMessage = result.Succeeded ? "工具链检查完成" : "工具链检查失败";
            await RefreshHealthAsync(cancellationToken);
        });
    }    [RelayCommand(CanExecute = nameof(CanCancel))]
    private void Cancel()
    {
        if (InstallUpdateCommand.IsRunning)
        {
            StatusMessage = "正在取消更新下载...";
            InstallUpdateCommand.Cancel();
            CancelCommand.NotifyCanExecuteChanged();
            return;
        }

        if (_operationCancellation is not { IsCancellationRequested: false } cancellation)
        {
            return;
        }

        StatusMessage = "正在取消当前任务...";
        cancellation.Cancel();
        CancelCommand.NotifyCanExecuteChanged();
    }

    private async Task RunAsync(string message, Func<CancellationToken, Action<string>, Task> action)
    {
        using var cancellation = new CancellationTokenSource();
        _operationCancellation = cancellation;
        IsBusy = true;
        StatusMessage = message;
        try
        {
            await action(cancellation.Token, ReportProgress);
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
    private void ApplyHealthReport(WorkspaceHealthReport health)
    {
        StatusMessage = health.IsHealthy ? "答案生成与排版主链已就绪" : health.Summary;
        StatusCards.Clear();
        StatusCards.Add(new StatusCardViewModel("Subject Packs", health.SubjectPacks.Count.ToString(), health.PrimarySubjectPack ?? "未发现"));
        StatusCards.Add(new StatusCardViewModel("Snapshot", health.SnapshotExists ? "Ready" : "Missing", health.SnapshotPath));
        StatusCards.Add(new StatusCardViewModel("Regression", health.EvalOk ? "Passed" : "Pending", $"{health.EvalCaseCount} cases"));
        StatusCards.Add(new StatusCardViewModel("Prompt", health.AssetVersion ?? "Unknown", health.LatestProductionSpecVersion ?? "未发现"));
        SyncSubjectPacks(health.SubjectPacks);
    }

    private async Task RefreshHealthAsync(CancellationToken cancellationToken = default)
    {
        // A health probe starts a real Node process.  Versioning protects the UI
        // from stale results, but cancelling the superseded probe protects the
        // machine from doing up to two minutes of unnecessary work per switch.
        using var refreshCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
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

            ApplyHealthReport(health);
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

    // A failed startup scan pins the picker to the fallback pack; every later
    // successful health refresh repairs it from the freshly observed packs.
    private void SyncSubjectPacks(IReadOnlyList<string> subjectPacks)
    {
        if (subjectPacks.Count == 0)
        {
            return;
        }

        var selectedPack = SelectedSubjectPack;
        var selectionChanged = false;
        _suppressHealthRefresh = true;
        try
        {
            AvailableSubjectPacks.Clear();
            foreach (var pack in subjectPacks)
            {
                AvailableSubjectPacks.Add(pack);
            }

            if (!AvailableSubjectPacks.Contains(selectedPack))
            {
                SelectedSubjectPack = AvailableSubjectPacks[0];
                selectionChanged = true;
            }
        }
        finally
        {
            _suppressHealthRefresh = false;
        }

        if (selectionChanged)
        {
            // The suppressed selection change would have started this refresh.
            SafeFireAndForget(() => RefreshHealthAsync(), "工作区健康检查");
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

    // Fire-and-forget work must still surface its failures: a discarded Task
    // hides unexpected faults until they resurface as an unobserved-exception
    // crash. Cancellation is expected and stays silent.
    private void SafeFireAndForget(Func<Task> operation, string description)
    {
        _ = ObserveAsync();

        async Task ObserveAsync()
        {
            try
            {
                await operation();
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                AppendLog($"{description}失败：{ex.Message}");
            }
        }
    }

    // Toolchain progress arrives on thread-pool threads from the process
    // runner; bound properties only update on the constructing context. In
    // hosts without a captured context (tests) the line is applied inline.
    private void ReportProgress(string line)
    {
        var context = _creationContext;
        if (context is not null && !ReferenceEquals(context, SynchronizationContext.Current))
        {
            context.Post(_ => AppendLog(line), null);
            return;
        }

        AppendLog(line);
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
            // Dropping the front half of a surrogate pair would render the
            // log's first character as U+FFFD; shed the orphan instead.
            if (char.IsLowSurrogate(normalized[0]))
            {
                normalized = normalized[1..];
            }
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
