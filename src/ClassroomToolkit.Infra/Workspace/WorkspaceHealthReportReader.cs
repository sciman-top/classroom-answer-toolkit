using System.Text.Json;
using System.Text.RegularExpressions;
using ClassroomToolkit.Domain.Toolchain;

namespace ClassroomToolkit.Infra.Workspace;

public sealed class WorkspaceHealthReportReader
{
    private static readonly Regex SpecPattern = new(
        @"(?:^|[-_])v(?<version>\d+\.\d+)(?:[-_]|\.md$)",
        RegexOptions.Compiled);

    private readonly string _repositoryRoot;

    public WorkspaceHealthReportReader(string repositoryRoot)
    {
        _repositoryRoot = repositoryRoot;
    }

    public WorkspaceHealthReport Read()
    {
        var issues = new List<string>();
        var subjectPacks = WorkspaceSubjectPackLocator.FindSubjectPacks(_repositoryRoot, issues);
        var subjectPack = subjectPacks.FirstOrDefault();
        var manifestPath = subjectPack?.ManifestPath ?? Path.Combine(_repositoryRoot, "prompts", "junior-physics-answer", "manifest.json");
        var configPath = subjectPack?.ConfigPath ?? Path.Combine(_repositoryRoot, "prompts", "junior-physics-answer", "config.json");
        var evalResultsPath = subjectPack?.EvalResultsPath ?? Path.Combine(_repositoryRoot, "eval", "junior-physics-answer", "results", "latest.json");

        if (subjectPack is null)
        {
            issues.Add("未发现有效的 subject pack manifest。");
        }

        var latestVersion = FindLatestProductionSpecVersion(manifestPath, issues);
        var manifestVersion = ReadManifestVersion(manifestPath, issues);
        var snapshotPath = ResolveSnapshotPath(configPath, manifestPath, issues);
        var snapshotStatus = ReadSnapshotStatus(snapshotPath, issues);
        var evalStatus = ReadEvalStatus(evalResultsPath, snapshotStatus.Profile, issues);

        if (latestVersion is null)
        {
            issues.Add("主 subject pack 的人类规范文件名缺少可识别版本。");
        }

        if (manifestVersion is null)
        {
            issues.Add("主 subject pack manifest 缺少 version。");
        }

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
        else if (snapshotStatus.Id is null || snapshotStatus.Version is null || snapshotStatus.Profile is null)
        {
            issues.Add("主 subject pack 的 snapshot 缺少 id、version 或 active profile。");
        }

        if (!evalStatus.Exists)
        {
            issues.Add("评测结果 latest.json 尚未生成。");
        }
        else if (!evalStatus.Ok)
        {
            issues.Add("固定回归未全部通过。");
        }
        else if (evalStatus.AssetVersion is null || evalStatus.CaseCount <= 0)
        {
            issues.Add("固定回归结果缺少 assetVersion 或有效 cases。");
        }
        else if (evalStatus.AssetVersion is not null && manifestVersion is not null && evalStatus.AssetVersion != manifestVersion)
        {
            issues.Add($"评测结果版本 {evalStatus.AssetVersion} 与资产版本 {manifestVersion} 不一致。");
        }
        else if (snapshotStatus.Id is not null && evalStatus.SnapshotId != snapshotStatus.Id)
        {
            issues.Add(evalStatus.SnapshotId is null
                ? "评测结果未绑定当前 snapshot。"
                : $"评测结果 snapshot {evalStatus.SnapshotId} 与当前 snapshot {snapshotStatus.Id} 不一致。");
        }

        var uniqueIssues = issues.Distinct(StringComparer.Ordinal).ToArray();
        var summary = uniqueIssues.Length == 0
            ? "规则快照、评测结果与最新规范已对齐。"
            : string.Join("；", uniqueIssues);

        return new WorkspaceHealthReport(
            PrimarySubjectPack: subjectPack?.AssetId ?? "junior-physics-answer",
            SubjectPacks: subjectPacks.Select(pack => pack.AssetId).ToArray(),
            LatestProductionSpecVersion: latestVersion is null ? null : $"v{latestVersion}",
            AssetVersion: manifestVersion,
            SnapshotExists: snapshotStatus.Exists,
            SnapshotPath: snapshotPath,
            SnapshotVersion: snapshotStatus.Version,
            SnapshotProfile: snapshotStatus.Profile,
            EvalExists: evalStatus.Exists,
            EvalOk: evalStatus.Ok,
            EvalCaseCount: evalStatus.CaseCount,
            Summary: summary,
            Issues: uniqueIssues);
    }

    private string? FindLatestProductionSpecVersion(string manifestPath, ICollection<string> issues)
    {
        return TryReadHumanSpecVersion(manifestPath, issues) ?? FindLatestRootSpecVersion();
    }

    private string? TryReadHumanSpecVersion(string manifestPath, ICollection<string> issues)
    {
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        using var document = TryReadJson(manifestPath, "subject pack manifest", issues);
        if (document is null)
        {
            return null;
        }
        if (!document.RootElement.TryGetProperty("sourceOfTruth", out var sourceOfTruthElement)
            || sourceOfTruthElement.ValueKind != JsonValueKind.Object
            || !sourceOfTruthElement.TryGetProperty("humanSpec", out var humanSpecElement)
            || humanSpecElement.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var humanSpecRelativePath = humanSpecElement.GetString();
        if (string.IsNullOrWhiteSpace(humanSpecRelativePath))
        {
            return null;
        }

        var humanSpecPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(manifestPath)!, humanSpecRelativePath));
        return TryParseVersionFromFileName(humanSpecPath);
    }

    private string? FindLatestRootSpecVersion()
    {
        return Directory
            .EnumerateFiles(_repositoryRoot, "*.md", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .Select(fileName => TryParseVersionFromFileName(fileName))
            .Where(static version => version is not null)
            .Select(static version => version!)
            .OrderBy(version => version, VersionComparer.Instance)
            .LastOrDefault();
    }

    private static string? TryParseVersionFromFileName(string? fileName)
    {
        var match = SpecPattern.Match(fileName ?? string.Empty);
        return match.Success ? match.Groups["version"].Value : null;
    }

    private static string? ReadManifestVersion(string manifestPath, ICollection<string> issues)
    {
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        using var document = TryReadJson(manifestPath, "subject pack manifest", issues);
        if (document is null)
        {
            return null;
        }
        return document.RootElement.TryGetProperty("version", out var versionElement)
            && versionElement.ValueKind == JsonValueKind.String
            ? versionElement.GetString()
            : null;
    }

    private static (bool Exists, string? Id, string? Version, string? Profile) ReadSnapshotStatus(
        string snapshotPath,
        ICollection<string> issues)
    {
        if (!File.Exists(snapshotPath))
        {
            return (false, null, null, null);
        }

        using var document = TryReadJson(snapshotPath, "snapshot", issues);
        if (document is null)
        {
            return (true, null, null, null);
        }
        var root = document.RootElement;
        var id = root.TryGetProperty("snapshotId", out var idElement)
            && idElement.ValueKind == JsonValueKind.String
            ? idElement.GetString()
            : null;
        var version = root.TryGetProperty("subjectPack", out var subjectPackElement)
            && subjectPackElement.ValueKind == JsonValueKind.Object
            && subjectPackElement.TryGetProperty("version", out var versionElement)
            && versionElement.ValueKind == JsonValueKind.String
                ? versionElement.GetString()
                : null;
        var profile = root.TryGetProperty("activeProfile", out var activeProfileElement)
            && activeProfileElement.ValueKind == JsonValueKind.Object
            && activeProfileElement.TryGetProperty("name", out var profileElement)
            && profileElement.ValueKind == JsonValueKind.String
                ? profileElement.GetString()
                : null;
        return (true, id, version, profile);
    }

    private static (bool Exists, bool Ok, string? AssetVersion, int CaseCount, string? SnapshotId) ReadEvalStatus(
        string evalResultsPath,
        string? profile,
        ICollection<string> issues)
    {
        if (!File.Exists(evalResultsPath))
        {
            return (false, false, null, 0, null);
        }

        using var document = TryReadJson(evalResultsPath, "eval result", issues);
        if (document is null)
        {
            return (true, false, null, 0, null);
        }
        var root = document.RootElement;
        var caseCount = root.TryGetProperty("cases", out var casesElement)
            && casesElement.ValueKind == JsonValueKind.Array
            ? casesElement.GetArrayLength()
            : 0;
        var assetVersion = root.TryGetProperty("assetVersion", out var assetVersionElement)
            && assetVersionElement.ValueKind == JsonValueKind.String
            ? assetVersionElement.GetString()
            : null;
        var ok = root.TryGetProperty("ok", out var okElement)
            && okElement.ValueKind is JsonValueKind.True or JsonValueKind.False
            && okElement.GetBoolean();
        var snapshotId = ReadEvalSnapshotId(root, profile);

        return (true, ok, assetVersion, caseCount, snapshotId);
    }

    private static string? ReadEvalSnapshotId(JsonElement root, string? profile)
    {
        if (string.IsNullOrWhiteSpace(profile)
            || !root.TryGetProperty("cases", out var casesElement)
            || casesElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var evalCase in casesElement.EnumerateArray())
        {
            if (evalCase.TryGetProperty("profiles", out var profiles)
                && profiles.ValueKind == JsonValueKind.Object
                && profiles.TryGetProperty(profile, out var profileResult)
                && profileResult.ValueKind == JsonValueKind.Object
                && profileResult.TryGetProperty("actual", out var actual)
                && actual.ValueKind == JsonValueKind.Object
                && actual.TryGetProperty("snapshot", out var snapshot)
                && snapshot.ValueKind == JsonValueKind.Object
                && snapshot.TryGetProperty("snapshotId", out var snapshotId))
            {
                return snapshotId.ValueKind == JsonValueKind.String ? snapshotId.GetString() : null;
            }
        }

        return null;
    }

    private static string ResolveSnapshotPath(
        string configPath,
        string manifestPath,
        ICollection<string> issues)
    {
        try
        {
            return WorkspaceSubjectPackLocator.ResolveSnapshotPath(configPath, manifestPath);
        }
        catch (Exception ex) when (ex is IOException
            or UnauthorizedAccessException
            or JsonException
            or InvalidOperationException)
        {
            issues.Add($"无法解析 snapshot 路径: {ex.Message}");
            return Path.Combine(Path.GetDirectoryName(configPath) ?? string.Empty, "..", "..", ".snapshot-cache", "resolved-snapshot.json");
        }
    }

    private static JsonDocument? TryReadJson(
        string filePath,
        string label,
        ICollection<string> issues)
    {
        try
        {
            return JsonDocument.Parse(File.ReadAllText(filePath));
        }
        catch (Exception ex) when (ex is IOException
            or UnauthorizedAccessException
            or JsonException)
        {
            issues.Add($"无法读取 {label} {filePath}: {ex.Message}");
            return null;
        }
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
