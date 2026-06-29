namespace ClassroomToolkit.Domain.Toolchain;

public sealed record ToolchainWorkspaceInfo(
    string RepositoryRoot,
    string BootstrapScriptPath,
    string CheckScriptPath,
    bool BootstrapScriptExists,
    bool CheckScriptExists,
    string? PrimarySubjectPack,
    IReadOnlyList<string> SubjectPacks)
{
    public bool IsReady => BootstrapScriptExists && CheckScriptExists;

    public string Summary => IsReady
        ? "工具链脚本已就绪，可继续执行 bootstrap 与体检。"
        : "工具链脚本缺失，仍可启动但相关按钮会给出失败提示。";
}
