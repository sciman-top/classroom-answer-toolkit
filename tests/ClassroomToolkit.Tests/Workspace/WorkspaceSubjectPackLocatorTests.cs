using System.Text.Json;
using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class WorkspaceSubjectPackLocatorTests
{
    [Fact]
    public void FindSubjectPacks_ListsPacks_ActiveAndPrimaryFirst()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WritePack("math-answer", status: "experimental");
        workspace.WritePack("senior-physics-answer", status: "active");
        workspace.WritePack("junior-physics-answer", status: "active");

        var packs = WorkspaceSubjectPackLocator.FindSubjectPacks(workspace.Root);

        packs.Select(pack => pack.AssetId).Should().Equal(
            "junior-physics-answer", "senior-physics-answer", "math-answer");
    }

    [Fact]
    public void FindSubjectPacks_DegradesBrokenManifestsToIssues()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WritePack("junior-physics-answer", status: "active");
        var brokenPath = Path.Combine(workspace.Root, "prompts", "broken-pack", "manifest.json");
        Directory.CreateDirectory(Path.GetDirectoryName(brokenPath)!);
        File.WriteAllText(brokenPath, "{ invalid json");
        var issues = new List<string>();

        var packs = WorkspaceSubjectPackLocator.FindSubjectPacks(workspace.Root, issues);

        packs.Select(pack => pack.AssetId).Should().Equal("junior-physics-answer");
        issues.Should().ContainSingle(issue => issue.Contains("broken-pack"));
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

        public void WritePack(string assetId, string status)
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
