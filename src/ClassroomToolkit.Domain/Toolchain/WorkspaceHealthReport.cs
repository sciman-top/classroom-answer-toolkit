namespace ClassroomToolkit.Domain.Toolchain;

public sealed record WorkspaceHealthReport(
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks,
    string? LatestProductionSpecVersion,
    string? AssetVersion,
    bool SnapshotExists,
    string SnapshotPath,
    bool EvalOk,
    int EvalCaseCount,
    string Summary,
    IReadOnlyList<string> Issues)
{
    public bool IsHealthy => Issues.Count == 0;
}
