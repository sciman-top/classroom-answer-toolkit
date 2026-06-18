using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class WorkspaceHealthReportReaderTests
{
    [Fact]
    public void Read_ReturnsHealthyReport_WhenSpecSnapshotAndEvalAreAligned()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteRootSpec("11.0");
        workspace.WriteManifest("v11.0", "../../初中物理试卷参考答案生成与渲染交付提示词_v11.0_生产完整版.md");
        workspace.WriteConfig("../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("v11.0", "classroom");
        workspace.WriteEval("v11.0", ok: true, caseCount: 4);
        workspace.WriteGraphics();

        var reader = new WorkspaceHealthReportReader(workspace.Root);

        var result = reader.Read();

        result.Issues.Should().BeEmpty();
        result.AssetVersion.Should().Be("v11.0");
        result.LatestProductionSpecVersion.Should().Be("v11.0");
        result.SnapshotExists.Should().BeTrue();
        result.EvalOk.Should().BeTrue();
        result.EvalCaseCount.Should().Be(4);
        result.GraphicsExists.Should().BeTrue();
        result.GraphicsSummary.Should().Contain("图块产物");
    }

    [Fact]
    public void Read_AddsIssue_WhenLatestProductionSpecIsNewerThanAssetVersion()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteRootSpec("11.0");
        workspace.WriteRootSpec("11.1");
        workspace.WriteManifest("v11.0", "../../初中物理试卷参考答案生成与渲染交付提示词_v11.0_生产完整版.md");
        workspace.WriteConfig("../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("v11.0", "classroom");
        workspace.WriteEval("v11.0", ok: true, caseCount: 4);

        var reader = new WorkspaceHealthReportReader(workspace.Root);

        var result = reader.Read();

        result.Issues.Should().ContainSingle(issue => issue.Contains("最新规范 v11.1", StringComparison.Ordinal));
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Health", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public void WriteRootSpec(string version)
        {
            File.WriteAllText(
                Path.Combine(Root, $"初中物理试卷参考答案生成与渲染交付提示词_v{version}_生产完整版.md"),
                $"# v{version}\n");
        }

        public void WriteManifest(string version, string humanSpec)
        {
            var manifestPath = Path.Combine(Root, "prompts", "physics-answer", "manifest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
            File.WriteAllText(
                manifestPath,
                $$"""
                {
                  "version": "{{version}}",
                  "sourceOfTruth": {
                    "humanSpec": "{{humanSpec}}"
                  }
                }
                """);
        }

        public void WriteConfig(string snapshotPath)
        {
            var configPath = Path.Combine(Root, "prompts", "physics-answer", "config.json");
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
            File.WriteAllText(
                configPath,
                $$"""
                {
                  "snapshot": {
                    "cachePath": "{{snapshotPath}}"
                  }
                }
                """);
        }

        public void WriteSnapshot(string version, string profile)
        {
            var snapshotPath = Path.Combine(Root, ".snapshot-cache", "resolved-snapshot.json");
            Directory.CreateDirectory(Path.GetDirectoryName(snapshotPath)!);
            File.WriteAllText(
                snapshotPath,
                $$"""
                {
                  "subjectPack": {
                    "version": "{{version}}"
                  },
                  "activeProfile": {
                    "name": "{{profile}}"
                  }
                }
                """);
        }

        public void WriteEval(string assetVersion, bool ok, int caseCount)
        {
            var evalPath = Path.Combine(Root, "eval", "physics-answer", "results", "latest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(evalPath)!);
            var cases = string.Join(",", Enumerable.Range(0, caseCount).Select(_ => "{}"));
            File.WriteAllText(
                evalPath,
                $$"""
                {
                  "assetVersion": "{{assetVersion}}",
                  "ok": {{ok.ToString().ToLowerInvariant()}},
                  "cases": [{{cases}}]
                }
                """);
        }

        public void WriteGraphics()
        {
            var graphicsPath = Path.Combine(Root, ".answer-graphics");
            Directory.CreateDirectory(graphicsPath);
            File.WriteAllText(Path.Combine(graphicsPath, "answer-graphic-preview.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />");
            File.WriteAllText(Path.Combine(graphicsPath, "placed-answer-graphic.json"), "{}");
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
