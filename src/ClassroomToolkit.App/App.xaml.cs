using System.Windows;
using System.Linq;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.App.ViewModels;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services;
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
                services.AddClassroomToolkitServices();
                services.AddSingleton<IRepositoryRootResolver>(_ => new RepositoryRootResolver(AppContext.BaseDirectory, repositoryRootOverride));
                services.AddWorkspaceDiagnosticsExport();
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

        var smoke = _host.Services.GetRequiredService<IHeadlessSmokeRunner>().Run();
        Console.WriteLine($"repositoryRoot={smoke.RepositoryRoot}");
        Console.WriteLine($"workspaceSummary={smoke.WorkspaceSummary}");
        Console.WriteLine($"workspaceHealthy={smoke.WorkspaceHealthy}");
        Console.WriteLine($"healthSummary={smoke.HealthSummary}");
        Console.WriteLine($"primarySubjectPack={smoke.PrimarySubjectPack}");
        Console.WriteLine($"subjectPacks={string.Join(",", smoke.SubjectPacks)}");
        Console.WriteLine($"snapshotPath={smoke.SnapshotPath}");
        Console.WriteLine($"lastDeliverySubjectPack={smoke.LastDeliverySubjectPack}");
        Console.WriteLine($"lastDeliveryProfile={smoke.LastDeliveryProfile}");
        Console.WriteLine($"lastSnapshotId={smoke.LastSnapshotId}");
        Console.WriteLine($"lastDeliverySnapshotPath={smoke.LastDeliverySnapshotPath}");
        Console.WriteLine($"lastDeliverySnapshotVersion={smoke.LastDeliverySnapshotVersion}");
        Console.WriteLine($"lastDeliveryInputPath={smoke.LastDeliveryInputPath}");
        Console.WriteLine($"lastDeliveryOutputPath={smoke.LastDeliveryOutputPath}");
        Console.WriteLine($"lastDeliveryReviewDirectoryPath={smoke.LastDeliveryReviewDirectoryPath}");
        Console.WriteLine($"lastDeliveryToolchainPassed={smoke.LastDeliveryToolchainPassed}");
        Console.WriteLine($"lastDeliveryComplete={smoke.LastDeliveryComplete}");
        Console.WriteLine($"lastDeliveryReviewArtifactReady={smoke.LastDeliveryReviewArtifactReady}");
        Console.WriteLine($"lastDeliveryVisualReviewPassed={smoke.LastDeliveryVisualReviewPassed}");
        Console.WriteLine($"lastDeliveryTrusted={smoke.LastDeliveryTrusted}");
        Console.WriteLine($"lastDeliveryGraphicCount={smoke.LastDeliveryGraphicCount}");
        Console.WriteLine($"diagnosticsBundlePath={smoke.DiagnosticsBundlePath}");
        Console.WriteLine($"diagnosticsManifestPath={smoke.DiagnosticsManifestPath}");
        Console.WriteLine($"diagnosticsFileCount={smoke.DiagnosticsFileCount}");
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
