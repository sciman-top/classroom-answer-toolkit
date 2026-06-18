using System.Text.Json;

namespace ClassroomToolkit.Infra.Workspace;

public sealed record WorkspaceSubjectPackPaths(
    string AssetId,
    string Status,
    string ManifestPath,
    string ConfigPath,
    string EvalResultsPath)
{
    public string SnapshotPath => WorkspaceSubjectPackLocator.ResolveSnapshotPath(ConfigPath);
}

public static class WorkspaceSubjectPackLocator
{
    public static IReadOnlyList<WorkspaceSubjectPackPaths> FindSubjectPacks(string repositoryRoot)
    {
        var promptsRoot = Path.Combine(repositoryRoot, "prompts");
        if (!Directory.Exists(promptsRoot))
        {
            return Array.Empty<WorkspaceSubjectPackPaths>();
        }

        var subjectPacks = new List<WorkspaceSubjectPackPaths>();
        foreach (var manifestPath in Directory.EnumerateFiles(promptsRoot, "manifest.json", SearchOption.AllDirectories))
        {
            var subjectPack = TryReadSubjectPack(manifestPath);
            if (subjectPack is not null)
            {
                subjectPacks.Add(subjectPack);
            }
        }

        return subjectPacks
            .OrderByDescending(pack => string.Equals(pack.Status, "active", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(pack => string.Equals(pack.AssetId, "physics-answer", StringComparison.OrdinalIgnoreCase))
            .ThenBy(pack => pack.AssetId, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static WorkspaceSubjectPackPaths? FindPrimarySubjectPack(string repositoryRoot)
    {
        var subjectPacks = FindSubjectPacks(repositoryRoot);
        return subjectPacks.FirstOrDefault();
    }

    public static string ResolveSnapshotPath(string configPath)
    {
        if (!File.Exists(configPath))
        {
            return Path.Combine(Path.GetTempPath(), ".snapshot-cache", "resolved-snapshot.json");
        }

        using var document = JsonDocument.Parse(File.ReadAllText(configPath));
        if (document.RootElement.TryGetProperty("snapshot", out var snapshotElement)
            && snapshotElement.TryGetProperty("cachePath", out var cachePathElement)
            && !string.IsNullOrWhiteSpace(cachePathElement.GetString()))
        {
            return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(configPath)!, cachePathElement.GetString()!));
        }

        return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(configPath)!, "..", "..", ".snapshot-cache", "resolved-snapshot.json"));
    }

    private static WorkspaceSubjectPackPaths? TryReadSubjectPack(string manifestPath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;

        if (!root.TryGetProperty("kind", out var kindElement)
            || !string.Equals(kindElement.GetString(), "subject-pack", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!root.TryGetProperty("assetId", out var assetIdElement))
        {
            return null;
        }

        var assetId = assetIdElement.GetString();
        if (string.IsNullOrWhiteSpace(assetId))
        {
            return null;
        }

        var packRoot = Path.GetDirectoryName(manifestPath)!;
        var status = root.TryGetProperty("status", out var statusElement)
            ? statusElement.GetString() ?? string.Empty
            : string.Empty;

        var configRelativePath = "./config.json";
        if (root.TryGetProperty("sourceOfTruth", out var sourceOfTruthElement)
            && sourceOfTruthElement.TryGetProperty("runtimeConfig", out var runtimeConfigElement)
            && !string.IsNullOrWhiteSpace(runtimeConfigElement.GetString()))
        {
            configRelativePath = runtimeConfigElement.GetString()!;
        }

        var evalResultsRelativePath = $"../../eval/{assetId}/results";
        if (root.TryGetProperty("evaluation", out var evaluationElement)
            && evaluationElement.TryGetProperty("resultsDir", out var resultsDirElement)
            && !string.IsNullOrWhiteSpace(resultsDirElement.GetString()))
        {
            evalResultsRelativePath = resultsDirElement.GetString()!;
        }

        return new WorkspaceSubjectPackPaths(
            assetId,
            status,
            manifestPath,
            Path.GetFullPath(Path.Combine(packRoot, configRelativePath)),
            Path.GetFullPath(Path.Combine(packRoot, evalResultsRelativePath, "latest.json")));
    }
}
