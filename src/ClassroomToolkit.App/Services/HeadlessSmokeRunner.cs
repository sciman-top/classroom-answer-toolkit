using ClassroomToolkit.Application.Abstractions;

namespace ClassroomToolkit.App.Services;

public sealed record HeadlessSmokeResult(
    string RepositoryRoot,
    string WorkspaceSummary,
    bool WorkspaceHealthy,
    string HealthSummary,
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks,
    string SnapshotPath,
    bool EvalOk,
    int EvalCaseCount);

public interface IHeadlessSmokeRunner
{
    HeadlessSmokeResult Run();
}

public sealed class HeadlessSmokeRunner : IHeadlessSmokeRunner
{
    private readonly IToolchainOrchestrator _toolchainOrchestrator;

    public HeadlessSmokeRunner(IToolchainOrchestrator toolchainOrchestrator)
    {
        _toolchainOrchestrator = toolchainOrchestrator;
    }

    public HeadlessSmokeResult Run()
    {
        var workspace = _toolchainOrchestrator.GetWorkspaceInfo();
        var health = _toolchainOrchestrator.GetWorkspaceHealthReport();
        return new HeadlessSmokeResult(
            workspace.RepositoryRoot,
            workspace.Summary,
            health.IsHealthy,
            health.Summary,
            health.PrimarySubjectPack,
            health.SubjectPacks,
            health.SnapshotPath,
            health.EvalOk,
            health.EvalCaseCount);
    }
}
