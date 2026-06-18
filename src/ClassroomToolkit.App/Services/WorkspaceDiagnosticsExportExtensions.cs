using Microsoft.Extensions.DependencyInjection;

namespace ClassroomToolkit.App.Services;

public static class WorkspaceDiagnosticsExportExtensions
{
    public static IServiceCollection AddWorkspaceDiagnosticsExport(this IServiceCollection services)
    {
        services.AddSingleton<IPathOpener, WindowsPathOpener>();
        services.AddSingleton<IWorkspaceDiagnosticsExporter, WorkspaceDiagnosticsExporter>();
        return services;
    }
}
