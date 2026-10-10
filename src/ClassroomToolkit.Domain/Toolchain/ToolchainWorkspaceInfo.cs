namespace ClassroomToolkit.Domain.Toolchain;

public sealed record ToolchainWorkspaceInfo(
    string RepositoryRoot,
    string BootstrapScriptPath,
    string CheckScriptPath,
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks);
