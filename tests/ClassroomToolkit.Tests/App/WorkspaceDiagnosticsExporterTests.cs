using System.Text.Json;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class WorkspaceDiagnosticsExporterTests
{
    [Fact]
    public void Export_CopiesPrimarySubjectPackArtifacts_AndWritesManifest()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteWorkspaceInputs();
        workspace.WriteGraphicsArtifacts();
        workspace.WriteDeliveryArtifacts();

        var exporter = new WorkspaceDiagnosticsExporter();
        var result = exporter.Export(new WorkspaceDiagnosticsExportRequest(
            workspace.Root,
            new WorkspaceHealthReport(
                "math-answer",
                ["math-answer", "physics-answer"],
                "v11.2",
                "v0.1",
                SnapshotExists: true,
                SnapshotPath: @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                SnapshotVersion: "v0.1",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 6,
                GraphicsExists: true,
                GraphicsSummary: "graphics ready",
                Summary: "workspace healthy",
                Issues: Array.Empty<string>()),
            workspace.OutputPdfPath,
            workspace.DeliveryManifestPath,
            workspace.ReviewDirectoryPath,
            "snapshot-test"));

        Directory.Exists(result.BundleDirectoryPath).Should().BeTrue();
        File.Exists(result.ManifestPath).Should().BeTrue();

        var workspaceBundle = Path.Combine(result.BundleDirectoryPath, "workspace");
        File.Exists(Path.Combine(workspaceBundle, "prompts", "math-answer", "manifest.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "prompts", "math-answer", "config.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "snapshot", "resolved-snapshot.math.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "eval", "latest.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "answer-graphics", "answer-graphic-preview.svg")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "answer-graphics", "placed-answer-graphic.json")).Should().BeTrue();

        var deliveryBundle = Path.Combine(result.BundleDirectoryPath, "delivery");
        File.Exists(Path.Combine(deliveryBundle, "answer.pdf")).Should().BeTrue();
        File.Exists(Path.Combine(deliveryBundle, "delivery-manifest.json")).Should().BeTrue();
        File.Exists(Path.Combine(deliveryBundle, "review", "review.html")).Should().BeTrue();

        using var manifest = JsonDocument.Parse(File.ReadAllText(result.ManifestPath));
        manifest.RootElement.GetProperty("kind").GetString().Should().Be("workspace-diagnostics-bundle");
        manifest.RootElement.GetProperty("primarySubjectPack").GetString().Should().Be("math-answer");
        manifest.RootElement.GetProperty("snapshotPath").GetString().Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.math.json");
        manifest.RootElement.GetProperty("subjectPacks").EnumerateArray().Select(static element => element.GetString()).Should().ContainInOrder("math-answer", "physics-answer");
        manifest.RootElement.GetProperty("lastSnapshotId").GetString().Should().Be("snapshot-test");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("subjectPack").GetString().Should().Be("math-answer");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("profile").GetString().Should().Be("classroom");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("snapshotId").GetString().Should().Be("snapshot-test");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("snapshotPath").GetString().Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.math.json");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("snapshotVersion").GetString().Should().Be("v0.1");
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("output").GetString().Should().Be(workspace.OutputPdfPath);
        manifest.RootElement.GetProperty("lastDeliveryContext").GetProperty("reviewDirectoryPath").GetString().Should().Be(workspace.ReviewDirectoryPath);
        manifest.RootElement.GetProperty("assets").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public void Export_UsesUniqueBundleDirectory_ForRapidRepeatedExports()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteWorkspaceInputs();

        var exporter = new WorkspaceDiagnosticsExporter();
        var request = new WorkspaceDiagnosticsExportRequest(
            workspace.Root,
            new WorkspaceHealthReport(
                "math-answer",
                ["math-answer"],
                "v11.2",
                "v0.1",
                SnapshotExists: true,
                SnapshotPath: @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                SnapshotVersion: "v0.1",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 6,
                GraphicsExists: false,
                GraphicsSummary: null,
                Summary: "workspace healthy",
                Issues: Array.Empty<string>()),
            null,
            null,
            null,
            null);

        var first = exporter.Export(request);
        var second = exporter.Export(request);

        first.BundleDirectoryPath.Should().NotBe(second.BundleDirectoryPath);
        first.ManifestPath.Should().NotBe(second.ManifestPath);
        Directory.Exists(first.BundleDirectoryPath).Should().BeTrue();
        Directory.Exists(second.BundleDirectoryPath).Should().BeTrue();
    }

    [Fact]
    public void Export_CopiesAllDiscoveredSubjectPacks_IntoSubjectPackIndex()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteSubjectPackInputs("math-answer", "v0.1", "../../.snapshot-cache/resolved-snapshot.math.json", "experimental");
        workspace.WriteSubjectPackInputs("physics-answer", "v11.2", "../../.snapshot-cache/resolved-snapshot.json", "active");

        var exporter = new WorkspaceDiagnosticsExporter();
        var result = exporter.Export(new WorkspaceDiagnosticsExportRequest(
            workspace.Root,
            new WorkspaceHealthReport(
                "physics-answer",
                ["physics-answer", "math-answer"],
                "v11.2",
                "v0.1",
                SnapshotExists: true,
                SnapshotPath: @"D:\repo\.snapshot-cache\resolved-snapshot.json",
                SnapshotVersion: "v0.1",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 6,
                GraphicsExists: false,
                GraphicsSummary: null,
                Summary: "workspace healthy",
                Issues: Array.Empty<string>()),
            null,
            null,
            null,
            null));

        var workspaceBundle = Path.Combine(result.BundleDirectoryPath, "workspace");
        File.Exists(Path.Combine(workspaceBundle, "subject-packs", "index.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "subject-packs", "physics-answer", "manifest.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "subject-packs", "math-answer", "manifest.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "subject-packs", "physics-answer", "snapshot", "resolved-snapshot.json")).Should().BeTrue();
        File.Exists(Path.Combine(workspaceBundle, "subject-packs", "math-answer", "snapshot", "resolved-snapshot.math.json")).Should().BeTrue();

        using var manifest = JsonDocument.Parse(File.ReadAllText(result.ManifestPath));
        manifest.RootElement.GetProperty("subjectPacks").GetArrayLength().Should().Be(2);
        manifest.RootElement.GetProperty("subjectPacks").EnumerateArray().Select(static element => element.GetString()).Should().ContainInOrder("physics-answer", "math-answer");

        using var index = JsonDocument.Parse(File.ReadAllText(Path.Combine(workspaceBundle, "subject-packs", "index.json")));
        index.RootElement.GetArrayLength().Should().Be(2);
        var physicsPack = index.RootElement.EnumerateArray().Single(element => element.GetProperty("assetId").GetString() == "physics-answer");
        physicsPack.GetProperty("isPrimary").GetBoolean().Should().BeTrue();
        physicsPack.GetProperty("version").GetString().Should().Be("v11.2");
        physicsPack.GetProperty("snapshotExists").GetBoolean().Should().BeTrue();
        physicsPack.GetProperty("snapshotVersion").GetString().Should().Be("v11.2");
        physicsPack.GetProperty("snapshotProfile").GetString().Should().Be("classroom");
        physicsPack.GetProperty("evalExists").GetBoolean().Should().BeTrue();
        physicsPack.GetProperty("evalOk").GetBoolean().Should().BeTrue();
        physicsPack.GetProperty("evalCaseCount").GetInt32().Should().Be(1);

        var mathPack = index.RootElement.EnumerateArray().Single(element => element.GetProperty("assetId").GetString() == "math-answer");
        mathPack.GetProperty("isPrimary").GetBoolean().Should().BeFalse();
        mathPack.GetProperty("version").GetString().Should().Be("v0.1");
        mathPack.GetProperty("snapshotExists").GetBoolean().Should().BeTrue();
        mathPack.GetProperty("snapshotVersion").GetString().Should().Be("v0.1");
        mathPack.GetProperty("snapshotProfile").GetString().Should().Be("classroom");
        mathPack.GetProperty("evalExists").GetBoolean().Should().BeTrue();
        mathPack.GetProperty("evalOk").GetBoolean().Should().BeTrue();
        mathPack.GetProperty("evalCaseCount").GetInt32().Should().Be(1);
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Diagnostics", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string OutputPdfPath => Path.Combine(Root, "sample-answer.pdf");

        public string DeliveryManifestPath => Path.Combine(Root, "sample-answer.delivery-manifest.json");

        public string ReviewDirectoryPath => Path.Combine(Root, ".pdf-review", "sample-answer");

        public void WriteWorkspaceInputs()
        {
            WriteSubjectPackInputs("math-answer", "v0.1", "../../.snapshot-cache/resolved-snapshot.math.json", "experimental");
        }

        public void WriteSubjectPackInputs(string assetId, string version, string snapshotCachePath, string status)
        {
            WriteJson(Path.Combine(Root, "prompts", assetId, "manifest.json"), new
            {
                kind = "subject-pack",
                assetId,
                version,
                status,
                sourceOfTruth = new { humanSpec = "./README.md" },
                entry = new { snapshotCache = snapshotCachePath },
                evaluation = new { resultsDir = $"../../eval/{assetId}/results" }
            });

            WriteJson(Path.Combine(Root, "prompts", assetId, "config.json"), new
            {
                snapshot = new { cachePath = snapshotCachePath }
            });

            var snapshotFileName = Path.GetFileName(snapshotCachePath);
            WriteJson(Path.Combine(Root, ".snapshot-cache", snapshotFileName), new
            {
                snapshotId = $"{assetId}-snapshot",
                subjectPack = new { version },
                activeProfile = new { name = "classroom" }
            });

            WriteJson(Path.Combine(Root, "eval", assetId, "results", "latest.json"), new
            {
                ok = true,
                cases = new[] { new { id = $"{assetId}-case-1" } }
            });
        }

        public void WriteGraphicsArtifacts()
        {
            var graphicsRoot = Path.Combine(Root, ".answer-graphics");
            Directory.CreateDirectory(graphicsRoot);

            WriteFile(Path.Combine(graphicsRoot, "answer-graphic-preview.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />");
            WriteFile(Path.Combine(graphicsRoot, "placed-answer-graphic.json"), "{}");
        }

        public void WriteDeliveryArtifacts()
        {
            WriteFile(OutputPdfPath, "pdf");
            WriteJson(DeliveryManifestPath, new
            {
                subjectPack = "math-answer",
                snapshotId = "snapshot-test",
                snapshotPath = @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                profile = "classroom",
                input = Path.Combine(Root, "sample-answer.md"),
                output = OutputPdfPath,
                snapshot = new
                {
                    version = "v0.1"
                },
                review = new
                {
                    outputDir = ReviewDirectoryPath
                }
            });
            WriteFile(Path.Combine(ReviewDirectoryPath, "review.html"), "<html></html>");
            WriteFile(Path.Combine(ReviewDirectoryPath, "sample-answer.page-001.png"), "png");
        }

        private static void WriteJson(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(value, Indented));
        }

        private static void WriteFile(string path, string content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
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
