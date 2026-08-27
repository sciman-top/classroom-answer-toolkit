using System.Windows;
using System.Linq;
using System.Text;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Process;
using ClassroomToolkit.Infra.Workspace;

namespace ClassroomToolkit.App;

public partial class App : System.Windows.Application
{
    private IToolchainOrchestrator? _toolchainOrchestrator;
    private MainViewModel? _viewModel;
    private IDisposable? _updateService;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var isSmoke = e.Args.Any(arg => string.Equals(arg, "--smoke", StringComparison.OrdinalIgnoreCase));
        try
        {
            var repositoryRootOverride = GetArgumentValue(e.Args, "--repository-root");
            var repositoryRootResolver = new RepositoryRootResolver(AppContext.BaseDirectory, repositoryRootOverride);
            IProcessRunner processRunner = new PowerShellProcessRunner();
            _toolchainOrchestrator = new LocalToolchainOrchestrator(repositoryRootResolver, processRunner);
            var repositoryRoot = repositoryRootResolver.ResolveRepositoryRoot();
            var updateService = new ReleaseUpdateService(repositoryRoot);
            _updateService = updateService;
            _viewModel = new MainViewModel(
                _toolchainOrchestrator,
                new WindowsPathOpener(),
                updateService);

            if (isSmoke)
            {
                RunHeadlessSmoke();
                Shutdown(0);
                return;
            }

            var window = new MainWindow
            {
                DataContext = _viewModel
            };
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            if (!isSmoke)
            {
                MessageBox.Show(
                    $"应用启动失败：{ex.Message}",
                    "Classroom Answer Toolkit",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _viewModel?.Dispose();
        _updateService?.Dispose();
        base.OnExit(e);
    }

    private void RunHeadlessSmoke()
    {
        Console.OutputEncoding = Encoding.UTF8;
        if (_toolchainOrchestrator is null)
        {
            throw new InvalidOperationException("Toolchain orchestrator not initialized.");
        }

        var workspace = _toolchainOrchestrator.GetWorkspaceInfo();
        // Blocking here is safe: the process runner never captures a synchronization
        // context (ConfigureAwait(false) throughout), so no continuation needs this
        // thread and the smoke has no pumped Dispatcher anyway.
        var health = _toolchainOrchestrator
            .GetWorkspaceHealthReportAsync(workspace.PrimarySubjectPack)
            .GetAwaiter().GetResult();
        Console.WriteLine($"repositoryRoot={workspace.RepositoryRoot}");
        Console.WriteLine($"workspaceSummary={workspace.Summary}");
        Console.WriteLine($"workspaceHealthy={health.IsHealthy}");
        Console.WriteLine($"healthSummary={health.Summary}");
        Console.WriteLine($"primarySubjectPack={health.PrimarySubjectPack}");
        Console.WriteLine($"subjectPacks={string.Join(",", health.SubjectPacks)}");
        Console.WriteLine($"snapshotPath={health.SnapshotPath}");
        Console.WriteLine($"evalOk={health.EvalOk}");
        Console.WriteLine($"evalCaseCount={health.EvalCaseCount}");
    }

    private static string? GetArgumentValue(IReadOnlyList<string> args, string name)
    {
        for (var index = 0; index < args.Count; index += 1)
        {
            var arg = args[index];
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase) && index + 1 < args.Count)
            {
                return args[index + 1];
            }

            if (arg.StartsWith($"{name}=", StringComparison.OrdinalIgnoreCase))
            {
                return arg[(name.Length + 1)..];
            }
        }

        return null;
    }
}
