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
                "v11.2",
                "v0.1",
                SnapshotExists: true,
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
                "v11.2",
                "v0.1",
                SnapshotExists: true,
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
            WriteJson(Path.Combine(Root, "prompts", "math-answer", "manifest.json"), new
            {
                kind = "subject-pack",
                assetId = "math-answer",
                version = "v0.1",
                status = "experimental",
                sourceOfTruth = new { humanSpec = "./README.md" },
                evaluation = new { resultsDir = "../../eval/math-answer/results" }
            });

            WriteJson(Path.Combine(Root, "prompts", "math-answer", "config.json"), new
            {
                snapshot = new { cachePath = "../../.snapshot-cache/resolved-snapshot.math.json" }
            });

            WriteJson(Path.Combine(Root, ".snapshot-cache", "resolved-snapshot.math.json"), new
            {
                snapshotId = "snapshot-test"
            });

            WriteJson(Path.Combine(Root, "eval", "math-answer", "results", "latest.json"), new
            {
                ok = true
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
                snapshotId = "snapshot-test"
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
