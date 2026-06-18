using System.Text.Json;
using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class WorkspaceSubjectPackLocatorTests
{
    [Fact]
    public void FindPrimarySubjectPack_PrefersActivePack()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WritePack("math-answer", status: "experimental", snapshotCachePath: "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WritePack("physics-answer", status: "active", snapshotCachePath: "../../.snapshot-cache/resolved-snapshot.json");

        var pack = WorkspaceSubjectPackLocator.FindPrimarySubjectPack(workspace.Root);

        pack.Should().NotBeNull();
        pack!.AssetId.Should().Be("physics-answer");
        pack.SnapshotPath.Should().EndWith("resolved-snapshot.json");
    }

    [Fact]
    public void FindPrimarySubjectPack_FallsBackToPhysicsAnswer_WhenMultipleActivePacksExist()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WritePack("math-answer", status: "active", snapshotCachePath: "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WritePack("physics-answer", status: "active", snapshotCachePath: "../../.snapshot-cache/resolved-snapshot.json");

        var pack = WorkspaceSubjectPackLocator.FindPrimarySubjectPack(workspace.Root);

        pack.Should().NotBeNull();
        pack!.AssetId.Should().Be("physics-answer");
    }

    [Fact]
    public void ResolveSnapshotPath_UsesConfiguredRelativePath()
    {
        using var workspace = new TemporaryWorkspace();
        var configPath = workspace.WriteConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");

        var resolved = WorkspaceSubjectPackLocator.ResolveSnapshotPath(configPath);

        resolved.Should().EndWith("resolved-snapshot.math.json");
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-SubjectPack", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string WritePack(string assetId, string status, string snapshotCachePath)
        {
            var manifestPath = Path.Combine(Root, "prompts", assetId, "manifest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);

            WriteJson(manifestPath, new
            {
                kind = "subject-pack",
                assetId,
                version = "v0.1",
                status,
                sourceOfTruth = new { runtimeConfig = "./config.json" },
                evaluation = new { resultsDir = $"../../eval/{assetId}/results" }
            });

            WriteConfig(assetId, snapshotCachePath);
            return manifestPath;
        }

        public string WriteConfig(string assetId, string snapshotCachePath)
        {
            var configPath = Path.Combine(Root, "prompts", assetId, "config.json");
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);

            WriteJson(configPath, new
            {
                snapshot = new { cachePath = snapshotCachePath }
            });

            return configPath;
        }

        private static void WriteJson(string path, object value)
        {
            File.WriteAllText(path, JsonSerializer.Serialize(value, Indented));
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
