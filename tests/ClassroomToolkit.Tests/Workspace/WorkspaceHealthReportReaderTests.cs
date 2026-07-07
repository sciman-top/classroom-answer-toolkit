using System.Text.Json;
using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class WorkspaceHealthReportReaderTests
{
    [Fact]
    public void Read_ReturnsHealthyReport_WhenPhysicsWorkspaceIsAligned()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.0");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.0", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.0", ok: true, caseCount: 4);
        workspace.WriteGraphics();

        var reader = new WorkspaceHealthReportReader(workspace.Root);
        var result = reader.Read();

        result.Issues.Should().BeEmpty();
        result.PrimarySubjectPack.Should().Be("junior-physics-answer");
        result.AssetVersion.Should().Be("v11.0");
        result.LatestProductionSpecVersion.Should().Be("v11.0");
        result.SnapshotExists.Should().BeTrue();
        result.EvalOk.Should().BeTrue();
        result.EvalCaseCount.Should().Be(4);
        result.GraphicsExists.Should().BeTrue();
        result.GraphicsSummary.Should().Contain("受控插图");
    }

    [Fact]
    public void Read_PicksActivePhysicsPack_WhenMathPackExistsAlongsidePhysicsPack()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.0");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.0", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.0", ok: true, caseCount: 4);

        workspace.WriteManifest("math-answer", "v0.1");
        workspace.WriteConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WriteSnapshot("math-answer", "v0.1", "classroom");
        workspace.WriteEval("math-answer", "v0.1", ok: true, caseCount: 1);

        var reader = new WorkspaceHealthReportReader(workspace.Root);
        var result = reader.Read();

        result.PrimarySubjectPack.Should().Be("junior-physics-answer");
        result.AssetVersion.Should().Be("v11.0");
        result.SnapshotVersion.Should().Be("v11.0");
        result.EvalCaseCount.Should().Be(4);
    }

    [Fact]
    public void Read_ReturnsHealthyReport_WhenMathWorkspaceUsesCompiledHumanSpec()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("math-answer", "v0.1");
        workspace.WriteConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WriteSnapshot("math-answer", "v0.1", "classroom");
        workspace.WriteEval("math-answer", "v0.1", ok: true, caseCount: 2);

        var reader = new WorkspaceHealthReportReader(workspace.Root);
        var result = reader.Read();

        result.Issues.Should().BeEmpty();
        result.PrimarySubjectPack.Should().Be("math-answer");
        result.AssetVersion.Should().Be("v0.1");
        result.LatestProductionSpecVersion.Should().Be("v0.1");
        result.SnapshotVersion.Should().Be("v0.1");
        result.EvalCaseCount.Should().Be(2);
    }

    [Fact]
    public void Read_AddsIssue_WhenLatestProductionSpecIsNewerThanAssetVersion()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteRootSpec("11.0");
        workspace.WriteRootSpec("11.1");
        workspace.WriteManifest("junior-physics-answer", "v11.0", "../../physics-spec.md");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.0", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.0", ok: true, caseCount: 4);

        var reader = new WorkspaceHealthReportReader(workspace.Root);
        var result = reader.Read();

        result.Issues.Should().ContainSingle(issue => issue.Contains("最新规范 v11.1", StringComparison.Ordinal));
    }

    [Fact]
    public void Read_DoesNotAddIssue_WhenExperimentalGraphicsDirectoryIsIncomplete()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.0");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.0", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.0", ok: true, caseCount: 4);
        workspace.WriteIncompleteGraphics();

        var reader = new WorkspaceHealthReportReader(workspace.Root);
        var result = reader.Read();

        result.Issues.Should().BeEmpty();
        result.GraphicsExists.Should().BeTrue();
        result.GraphicsSummary.Should().Contain("实验性");
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Health", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public void WriteRootSpec(string version)
        {
            File.WriteAllText(
                Path.Combine(Root, $"spec_v{version}_release.md"),
                $"# v{version}\n");
        }

        public void WriteManifest(string subjectPack, string version, string? humanSpec = null)
        {
            var manifestPath = Path.Combine(Root, "prompts", subjectPack, "manifest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
            humanSpec ??= BuildCompiledHumanSpecPath(subjectPack, version);

            var manifest = new
            {
                kind = "subject-pack",
                assetId = subjectPack,
                version,
                status = subjectPack == "math-answer" ? "experimental" : "active",
                sourceOfTruth = new
                {
                    humanSpec,
                    mirroredSpec = "./spec.md",
                    acceptanceChecklist = "./checklists/acceptance.md",
                    runtimeConfig = "./config.json"
                },
                evaluation = new { resultsDir = $"../../eval/{subjectPack}/results" }
            };

            File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifest, Indented));
        }

        public void WriteConfig(string subjectPack, string snapshotPath)
        {
            var configPath = Path.Combine(Root, "prompts", subjectPack, "config.json");
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);

            var config = new
            {
                snapshot = new { cachePath = snapshotPath }
            };

            File.WriteAllText(configPath, JsonSerializer.Serialize(config, Indented));
        }

        public void WriteSnapshot(string subjectPack, string version, string profile)
        {
            var snapshotFileName = subjectPack == "math-answer"
                ? "resolved-snapshot.math.json"
                : "resolved-snapshot.json";
            var snapshotPath = Path.Combine(Root, ".snapshot-cache", snapshotFileName);
            Directory.CreateDirectory(Path.GetDirectoryName(snapshotPath)!);

            var snapshot = new
            {
                subjectPack = new { version },
                activeProfile = new { name = profile }
            };

            File.WriteAllText(snapshotPath, JsonSerializer.Serialize(snapshot, Indented));
        }

        public void WriteEval(string subjectPack, string assetVersion, bool ok, int caseCount)
        {
            var evalPath = Path.Combine(Root, "eval", subjectPack, "results", "latest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(evalPath)!);

            var eval = new
            {
                assetVersion,
                ok,
                cases = Enumerable.Range(0, caseCount).Select(_ => new { }).ToArray()
            };

            File.WriteAllText(evalPath, JsonSerializer.Serialize(eval, Indented));
        }

        public void WriteGraphics()
        {
            var graphicsPath = Path.Combine(Root, ".answer-graphics");
            Directory.CreateDirectory(graphicsPath);
            File.WriteAllText(Path.Combine(graphicsPath, "answer-graphic-preview.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />");
            File.WriteAllText(Path.Combine(graphicsPath, "placed-answer-graphic.json"), "{}");
        }

        public void WriteIncompleteGraphics()
        {
            var graphicsPath = Path.Combine(Root, ".answer-graphics");
            Directory.CreateDirectory(graphicsPath);
            File.WriteAllText(Path.Combine(graphicsPath, "readme.txt"), "experimental");
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }

        private static string BuildCompiledHumanSpecPath(string subjectPack, string version)
        {
            return subjectPack switch
            {
                "junior-physics-answer" => $"../specs/compiled/试卷参考答案交付规范-初中物理-完整版-{version}.md",
                "senior-physics-answer" => $"../specs/compiled/试卷参考答案交付规范-高中物理-完整版-{version}.md",
                "math-answer" => $"../specs/compiled/试卷参考答案交付规范-初中数学-完整版-{version}.md",
                _ => $"../specs/compiled/{subjectPack}-full-{version}.md"
            };
        }
    }
}
