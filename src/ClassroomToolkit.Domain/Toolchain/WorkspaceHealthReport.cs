namespace ClassroomToolkit.Domain.Toolchain;

public sealed record WorkspaceHealthReport(
    string? LatestProductionSpecVersion,
    string? AssetVersion,
    bool SnapshotExists,
    string? SnapshotVersion,
    string? SnapshotProfile,
    bool EvalExists,
    bool EvalOk,
    int EvalCaseCount,
    bool GraphicsExists,
    string? GraphicsSummary,
    string Summary,
    IReadOnlyList<string> Issues)
{
    public bool IsHealthy => Issues.Count == 0;
}
