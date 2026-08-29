using System.Text.Json;

namespace ClassroomToolkit.Infra.Workspace;

public sealed record WorkspaceSubjectPackPaths(
    string AssetId,
    string Status);

public static class WorkspaceSubjectPackLocator
{
    public static IReadOnlyList<WorkspaceSubjectPackPaths> FindSubjectPacks(
        string repositoryRoot,
        ICollection<string>? issues = null)
    {
        var promptsRoot = Path.Combine(repositoryRoot, "prompts");
        if (!Directory.Exists(promptsRoot))
        {
            return Array.Empty<WorkspaceSubjectPackPaths>();
        }

        var subjectPacks = new List<WorkspaceSubjectPackPaths>();
        // ACL/AV/sync-tool locked subdirectories must degrade to an issue note instead of
        // aborting the enumeration (and with it app startup).
        var enumerationOptions = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true
        };
        foreach (var manifestPath in Directory.EnumerateFiles(promptsRoot, "manifest.json", enumerationOptions))
        {
            WorkspaceSubjectPackPaths? subjectPack;
            try
            {
                subjectPack = TryReadSubjectPack(manifestPath);
            }
            catch (Exception ex) when (ex is IOException
                or UnauthorizedAccessException
                or JsonException
                or InvalidOperationException)
            {
                issues?.Add($"无法读取 subject pack manifest {manifestPath}: {ex.Message}");
                continue;
            }

            if (subjectPack is not null)
            {
                subjectPacks.Add(subjectPack);
            }
        }

        return subjectPacks
            .OrderByDescending(pack => string.Equals(pack.Status, "active", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(pack => string.Equals(pack.AssetId, "junior-physics-answer", StringComparison.OrdinalIgnoreCase))
            .ThenBy(pack => pack.AssetId, StringComparer.OrdinalIgnoreCase)
            .ToArray();
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

        var status = root.TryGetProperty("status", out var statusElement)
            ? statusElement.GetString() ?? string.Empty
            : string.Empty;

        return new WorkspaceSubjectPackPaths(assetId, status);
    }
}
