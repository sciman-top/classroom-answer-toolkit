using System.Windows;
using System.Linq;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Domain.Toolchain;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Process;
using ClassroomToolkit.Infra.Workspace;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClassroomToolkit.App;

public partial class App : System.Windows.Application
{
    private IHost? _host;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _host = Host.CreateDefaultBuilder(e.Args)
            .ConfigureServices(services =>
            {
                var repositoryRootOverride = GetArgumentValue(e.Args, "--repository-root");
                services.AddSingleton(_ => new RepositoryRootResolver(AppContext.BaseDirectory, repositoryRootOverride));
                services.AddSingleton<IProcessRunner, PowerShellProcessRunner>();
                services.AddSingleton<IToolchainOrchestrator, LocalToolchainOrchestrator>();
                services.AddSingleton<IPathOpener, WindowsPathOpener>();
                services.AddSingleton<MainViewModel>();
                services.AddSingleton<MainWindow>();
            })
            .Build();

        await _host.StartAsync();

        if (e.Args.Any(arg => string.Equals(arg, "--smoke", StringComparison.OrdinalIgnoreCase)))
        {
            RunHeadlessSmoke();
            Shutdown(0);
            return;
        }

        var window = _host.Services.GetRequiredService<MainWindow>();
        window.DataContext = _host.Services.GetRequiredService<MainViewModel>();
        MainWindow = window;
        window.Show();
    }

    protected override async void OnExit(ExitEventArgs e)
    {
        if (_host is not null)
        {
            await _host.StopAsync(TimeSpan.FromSeconds(5));
            _host.Dispose();
        }

        base.OnExit(e);
    }

    private void RunHeadlessSmoke()
    {
        if (_host is null)
        {
            throw new InvalidOperationException("Host not initialized.");
        }

        var orchestrator = _host.Services.GetRequiredService<IToolchainOrchestrator>();
        var workspace = orchestrator.GetWorkspaceInfo();
        var health = orchestrator.GetWorkspaceHealthReport();
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
