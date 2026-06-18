using System.Text.Json;
using System.Text.RegularExpressions;
using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Infra.Workspace;

public sealed class WorkspaceHealthReportReader
{
    private static readonly Regex SpecPattern = new(
        @"^.*_v(?<version>\d+\.\d+)_.*\.md$",
        RegexOptions.Compiled);

    private readonly string _repositoryRoot;

    public WorkspaceHealthReportReader(string repositoryRoot)
    {
        _repositoryRoot = repositoryRoot;
    }

    public WorkspaceHealthReport Read()
    {
        var subjectPack = WorkspaceSubjectPackLocator.FindPrimarySubjectPack(_repositoryRoot);
        var manifestPath = subjectPack?.ManifestPath ?? Path.Combine(_repositoryRoot, "prompts", "physics-answer", "manifest.json");
        var configPath = subjectPack?.ConfigPath ?? Path.Combine(_repositoryRoot, "prompts", "physics-answer", "config.json");
        var evalResultsPath = subjectPack?.EvalResultsPath ?? Path.Combine(_repositoryRoot, "eval", "physics-answer", "results", "latest.json");
        var graphicsPath = Path.Combine(_repositoryRoot, ".answer-graphics");

        var latestVersion = FindLatestProductionSpecVersion();
        var manifestVersion = ReadManifestVersion(manifestPath);
        var snapshotPath = WorkspaceSubjectPackLocator.ResolveSnapshotPath(configPath);
        var snapshotStatus = ReadSnapshotStatus(snapshotPath);
        var evalStatus = ReadEvalStatus(evalResultsPath);
        var graphicsStatus = ReadGraphicsStatus(graphicsPath);

        var issues = new List<string>();

        if (latestVersion is not null && manifestVersion is not null && manifestVersion != $"v{latestVersion}")
        {
            issues.Add($"最新规范 v{latestVersion} 与资产版本 {manifestVersion} 不一致。");
        }

        if (!snapshotStatus.Exists)
        {
            issues.Add("主 subject pack 的 snapshot 尚未生成。");
        }
        else if (snapshotStatus.Version is not null && manifestVersion is not null && snapshotStatus.Version != manifestVersion)
        {
            issues.Add($"snapshot 版本 {snapshotStatus.Version} 与资产版本 {manifestVersion} 不一致。");
        }

        if (!evalStatus.Exists)
        {
            issues.Add("评测结果 latest.json 尚未生成。");
        }
        else if (!evalStatus.Ok)
        {
            issues.Add("固定回归未全部通过。");
        }
        else if (evalStatus.AssetVersion is not null && manifestVersion is not null && evalStatus.AssetVersion != manifestVersion)
        {
            issues.Add($"评测结果版本 {evalStatus.AssetVersion} 与资产版本 {manifestVersion} 不一致。");
        }

        if (graphicsStatus.Exists && !graphicsStatus.HasPreview)
        {
            issues.Add("作图题图块产物缺少预览图。");
        }

        var summary = issues.Count == 0
            ? "规则快照、评测结果与最新规范已对齐。"
            : string.Join("；", issues);

        return new WorkspaceHealthReport(
            LatestProductionSpecVersion: latestVersion is null ? null : $"v{latestVersion}",
            AssetVersion: manifestVersion,
            SnapshotExists: snapshotStatus.Exists,
            SnapshotVersion: snapshotStatus.Version,
            SnapshotProfile: snapshotStatus.Profile,
            EvalExists: evalStatus.Exists,
            EvalOk: evalStatus.Ok,
            EvalCaseCount: evalStatus.CaseCount,
            GraphicsExists: graphicsStatus.Exists,
            GraphicsSummary: graphicsStatus.Summary,
            Summary: summary,
            Issues: issues);
    }

    private string? FindLatestProductionSpecVersion()
    {
        return Directory
            .EnumerateFiles(_repositoryRoot, "*.md", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .Select(fileName => SpecPattern.Match(fileName ?? string.Empty))
            .Where(match => match.Success)
            .Select(match => match.Groups["version"].Value)
            .OrderBy(version => version, VersionComparer.Instance)
            .LastOrDefault();
    }

    private static string? ReadManifestVersion(string manifestPath)
    {
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        return document.RootElement.TryGetProperty("version", out var versionElement)
            ? versionElement.GetString()
            : null;
    }

    private static (bool Exists, string? Version, string? Profile) ReadSnapshotStatus(string snapshotPath)
    {
        if (!File.Exists(snapshotPath))
        {
            return (false, null, null);
        }

        using var document = JsonDocument.Parse(File.ReadAllText(snapshotPath));
        var root = document.RootElement;
        var version = root.TryGetProperty("subjectPack", out var subjectPackElement)
            && subjectPackElement.TryGetProperty("version", out var versionElement)
                ? versionElement.GetString()
                : null;
        var profile = root.TryGetProperty("activeProfile", out var activeProfileElement)
            && activeProfileElement.TryGetProperty("name", out var profileElement)
                ? profileElement.GetString()
                : null;
        return (true, version, profile);
    }

    private static (bool Exists, bool Ok, string? AssetVersion, int CaseCount) ReadEvalStatus(string evalResultsPath)
    {
        if (!File.Exists(evalResultsPath))
        {
            return (false, false, null, 0);
        }

        using var document = JsonDocument.Parse(File.ReadAllText(evalResultsPath));
        var root = document.RootElement;
        var caseCount = root.TryGetProperty("cases", out var casesElement) ? casesElement.GetArrayLength() : 0;
        var assetVersion = root.TryGetProperty("assetVersion", out var assetVersionElement)
            ? assetVersionElement.GetString()
            : null;
        var ok = root.TryGetProperty("ok", out var okElement) && okElement.GetBoolean();

        return (true, ok, assetVersion, caseCount);
    }

    private static (bool Exists, bool HasPreview, string Summary) ReadGraphicsStatus(string graphicsPath)
    {
        if (!Directory.Exists(graphicsPath))
        {
            return (false, false, "作图题图块产物目录尚未生成。");
        }

        var previewExists = File.Exists(Path.Combine(graphicsPath, "answer-graphic-preview.svg"))
            || File.Exists(Path.Combine(graphicsPath, "placed-answer-graphic.json"));

        var artifactExists = File.Exists(Path.Combine(graphicsPath, "answer-graphic-artifact.json"));
        var placedExists = File.Exists(Path.Combine(graphicsPath, "placed-answer-graphic.json"));

        var summary = previewExists
            ? $"图块产物已生成{(artifactExists ? "，包含 artifact" : string.Empty)}{(placedExists ? "，包含 placement 记录" : string.Empty)}。"
            : "作图题图块产物缺少预览图。";

        return (true, previewExists, summary);
    }

    private sealed class VersionComparer : IComparer<string>
    {
        public static readonly VersionComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            if (x is null && y is null)
            {
                return 0;
            }

            if (x is null)
            {
                return -1;
            }

            if (y is null)
            {
                return 1;
            }

            var left = x.Split('.').Select(static part => int.TryParse(part, out var value) ? value : 0).ToArray();
            var right = y.Split('.').Select(static part => int.TryParse(part, out var value) ? value : 0).ToArray();
            var length = Math.Max(left.Length, right.Length);
            for (var index = 0; index < length; index += 1)
            {
                var leftValue = index < left.Length ? left[index] : 0;
                var rightValue = index < right.Length ? right[index] : 0;
                if (leftValue != rightValue)
                {
                    return leftValue.CompareTo(rightValue);
                }
            }

            return 0;
        }
    }
}
