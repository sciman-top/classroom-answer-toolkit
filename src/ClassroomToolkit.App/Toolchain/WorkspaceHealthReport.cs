namespace ClassroomToolkit.App.Toolchain;

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
    IReadOnlyList<string> Issues,
    bool AiConfigured = false,
    bool CloudEgressConfigured = false)
{
    public bool AiReady => AiConfigured && CloudEgressConfigured;
    public bool IsHealthy => Issues.Count == 0;
}
