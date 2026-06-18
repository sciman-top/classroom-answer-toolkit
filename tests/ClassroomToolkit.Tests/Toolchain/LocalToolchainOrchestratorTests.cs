using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class LocalToolchainOrchestratorTests
{
    [Fact]
    public void GetWorkspaceHealthReport_ReturnsHealthyState_WhenWorkspaceIsAligned()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteRootSpec("11.1");
        workspace.WriteManifest("v11.1");
        workspace.WriteConfig();
        workspace.WriteSnapshot("v11.1", "classroom");
        workspace.WriteEval("v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new FakeProcessRunner());

        var result = orchestrator.GetWorkspaceHealthReport();

        result.IsHealthy.Should().BeTrue();
        result.EvalCaseCount.Should().Be(5);
        result.Summary.Should().Contain("已对齐");
    }

    [Fact]
    public async Task RunDeliverAsync_PreservesSnapshotId_FromWrittenDeliveryManifest()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteRootSpec("11.1");
        workspace.WriteManifest("v11.1");
        workspace.WriteConfig();
        workspace.WriteSnapshot("v11.1", "classroom");
        workspace.WriteEval("v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();
        workspace.WriteDeliveryManifest("snapshot-test");

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new FakeDeliverProcessRunner());

        var (execution, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: true));

        execution.Succeeded.Should().BeTrue();
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().Be("snapshot-test");
    }

    private sealed class FakeProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class FakeDeliverProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase)
                && arguments.Count >= 3
                && arguments[0] == "--prefix"
                && arguments[2] == "run"
                && arguments[3] == "deliver")
            {
                var manifestPath = Path.Combine(
                    workingDirectory,
                    "习题PDF",
                    "sample-answer.delivery-manifest.json");

                File.WriteAllText(
                    manifestPath,
                    """
                    {
                      "schemaVersion": "1.0",
                      "kind": "delivery-manifest",
                      "generatedAt": "2026-06-18T00:00:00Z",
                      "snapshotId": "snapshot-test",
                      "snapshotPath": "D:\\repo\\.snapshot-cache\\resolved-snapshot.json",
                      "snapshot": {
                        "id": "snapshot-test",
                        "version": "v11.1",
                        "profile": "classroom"
                      },
                      "profile": "classroom",
                      "input": "D:\\repo\\习题PDF\\sample-answer.md",
                      "output": "D:\\repo\\习题PDF\\sample-answer.pdf",
                      "review": {
                        "outputDir": "D:\\repo\\.pdf-review\\sample-answer",
                        "manifestPath": "D:\\repo\\.pdf-review\\sample-answer\\manifest.json",
                        "scale": "2"
                      }
                    }
                    """);
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Orchestrator", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string AnswerMarkdownPath => Path.Combine(Root, "习题PDF", "sample-answer.md");

        public void WriteRootSpec(string version)
        {
            File.WriteAllText(Path.Combine(Root, $"初中物理试卷参考答案生成与渲染交付提示词_v{version}_生产完整版.md"), $"# v{version}\n");
        }

        public void WriteManifest(string version)
        {
            var manifestPath = Path.Combine(Root, "prompts", "physics-answer", "manifest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
            File.WriteAllText(
                manifestPath,
                $$"""
                {
                  "version": "{{version}}",
                  "sourceOfTruth": {
                    "humanSpec": "../../初中物理试卷参考答案生成与渲染交付提示词_{{version.Replace("v", "_v")}}_生产完整版.md"
                  }
                }
                """);
        }

        public void WriteConfig()
        {
            var configPath = Path.Combine(Root, "prompts", "physics-answer", "config.json");
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
            File.WriteAllText(
                configPath,
                """
                {
                  "snapshot": {
                    "cachePath": "../../.snapshot-cache/resolved-snapshot.json"
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

        public void WriteAnswerMarkdown()
        {
            var answerPath = AnswerMarkdownPath;
            Directory.CreateDirectory(Path.GetDirectoryName(answerPath)!);
            File.WriteAllText(answerPath, "# sample answer\n");
        }

        public void WriteDeliveryManifest(string snapshotId)
        {
            var manifestPath = Path.Combine(Root, "习题PDF", "sample-answer.delivery-manifest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
            File.WriteAllText(
                manifestPath,
                $$"""
                {
                  "schemaVersion": "1.0",
                  "kind": "delivery-manifest",
                  "generatedAt": "2026-06-18T00:00:00Z",
                  "snapshotId": "{{snapshotId}}",
                  "snapshotPath": "../../.snapshot-cache/resolved-snapshot.json",
                  "snapshot": {
                    "id": "{{snapshotId}}",
                    "version": "v11.1",
                    "profile": "classroom"
                  },
                  "profile": "classroom",
                  "input": "{{AnswerMarkdownPath}}",
                  "output": "{{Path.ChangeExtension(AnswerMarkdownPath, ".pdf")}}",
                  "review": {
                    "outputDir": "{{Path.Combine(Root, ".pdf-review", "sample-answer")}}",
                    "manifestPath": "{{Path.Combine(Root, ".pdf-review", "sample-answer", "manifest.json")}}",
                    "scale": "2"
                  }
                }
                """);
        }

        public void WriteSupportFiles()
        {
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "# bootstrap\n");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "# check\n");
            File.WriteAllText(Path.Combine(Root, "global.json"), "{}\n");
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "solution\n");
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
