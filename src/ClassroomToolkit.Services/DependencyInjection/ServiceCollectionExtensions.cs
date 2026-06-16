using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Process;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services.Toolchain;
using Microsoft.Extensions.DependencyInjection;

namespace ClassroomToolkit.Services;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddClassroomToolkitServices(this IServiceCollection services)
    {
        services.AddSingleton<IRepositoryRootResolver, RepositoryRootResolver>();
        services.AddSingleton<IProcessRunner, PowerShellProcessRunner>();
        services.AddSingleton<IToolchainOrchestrator, LocalToolchainOrchestrator>();
        return services;
    }
}
