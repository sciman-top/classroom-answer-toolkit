using System.Text.Json;
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
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new FakeProcessRunner());

        var result = orchestrator.GetWorkspaceHealthReport();

        result.IsHealthy.Should().BeTrue();
        result.EvalCaseCount.Should().Be(5);
        result.LatestProductionSpecVersion.Should().Be("v11.1");
    }

    [Fact]
    public async Task RunDeliverAsync_PreservesSnapshotId_FromWrittenDeliveryManifest()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
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
                KeepReviewArtifacts: true,
                SubjectPack: "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        execution.ScriptPath.Should().EndWith(@"tools\latex-renderer\deliver-answer.mjs");
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().Be("snapshot-test");
        delivery.SubjectPack.Should().Be("junior-physics-answer");
        delivery.Profile.Should().Be("classroom");
        delivery.SnapshotPath.Should().Be("D:\\repo\\.snapshot-cache\\resolved-snapshot.json");
        delivery.SnapshotVersion.Should().Be("v11.1");
    }

    [Fact]
    public async Task RunDeliverAsync_PassesPrimarySubjectPack_ToDeliverScript()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("math-answer", "v0.1", status: "experimental");
        workspace.WriteConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
        workspace.WriteSnapshot("math-answer", "v0.1", "classroom");
        workspace.WriteEval("math-answer", "v0.1", ok: true, caseCount: 2);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();
        workspace.WriteDeliveryManifest("snapshot-math");

        var processRunner = new CapturingDeliverProcessRunner();
        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, processRunner);

        var (execution, _) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: false));

        execution.Succeeded.Should().BeTrue();
        processRunner.LastArguments.Should().NotBeNull();
        processRunner.LastArguments.Should().Contain("--subject-pack");
        processRunner.LastArguments.Should().Contain("math-answer");
    }

    [Fact]
    public async Task RunDeliverAsync_DoesNotTrustLegacyTopLevelSnapshotId_WhenSnapshotBlockIsMissing()
    {
        using var workspace = new TemporaryWorkspace();
        workspace.WriteManifest("junior-physics-answer", "v11.1");
        workspace.WriteConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
        workspace.WriteSnapshot("junior-physics-answer", "v11.1", "classroom");
        workspace.WriteEval("junior-physics-answer", "v11.1", ok: true, caseCount: 5);
        workspace.WriteSupportFiles();
        workspace.WriteAnswerMarkdown();

        var resolver = new RepositoryRootResolver(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(resolver, new LegacyTopLevelSnapshotIdProcessRunner());

        var (execution, delivery) = await orchestrator.RunDeliverAsync(
            new AnswerDeliveryRequest(
                workspace.AnswerMarkdownPath,
                null,
                "classroom",
                KeepReviewArtifacts: false,
                SubjectPack: "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().BeNull();
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
                && arguments.Count >= 4
                && arguments[0] == "--prefix"
                && arguments[2] == "run"
                && arguments[3] == "deliver")
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");

                var manifest = new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    generatedAt = "2026-06-18T00:00:00Z",
                    subjectPack = "junior-physics-answer",
                    snapshotId = "snapshot-test",
                    snapshotPath = "D:\\repo\\.snapshot-cache\\resolved-snapshot.json",
                    snapshot = new
                    {
                        id = "snapshot-test",
                        version = "v11.1",
                        profile = "classroom"
                    },
                    profile = "classroom",
                    input = "D:\\repo\\sample-answer.md",
                    output = "D:\\repo\\sample-answer.pdf",
                    review = new
                    {
                        outputDir = "D:\\repo\\.pdf-review\\sample-answer",
                        manifestPath = "D:\\repo\\.pdf-review\\sample-answer\\manifest.json",
                        scale = "2"
                    }
                };

                File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class CapturingDeliverProcessRunner : IProcessRunner
    {
        public IReadOnlyList<string>? LastArguments { get; private set; }

        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            LastArguments = arguments.ToArray();

            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase))
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    subjectPack = "math-answer",
                    snapshotId = "snapshot-math",
                    snapshot = new
                    {
                        id = "snapshot-math",
                        version = "v0.1",
                        profile = "classroom"
                    }
                }, new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class LegacyTopLevelSnapshotIdProcessRunner : IProcessRunner
    {
        public Task<ProcessRunResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            CancellationToken cancellationToken = default)
        {
            if (string.Equals(fileName, "npm", StringComparison.OrdinalIgnoreCase))
            {
                var manifestPath = Path.Combine(workingDirectory, "sample-answer.delivery-manifest.json");
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
                {
                    schemaVersion = "1.0",
                    kind = "delivery-manifest",
                    subjectPack = "junior-physics-answer",
                    snapshotId = "legacy-top-level-only",
                    profile = "classroom"
                }, new JsonSerializerOptions { WriteIndented = true }));
            }

            return Task.FromResult(new ProcessRunResult(0, string.Empty, string.Empty, TimeSpan.Zero));
        }
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Orchestrator", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string AnswerMarkdownPath => Path.Combine(Root, "sample-answer.md");

        public void WriteRootSpec(string version)
        {
            File.WriteAllText(Path.Combine(Root, $"spec_v{version}_release.md"), $"# v{version}\n");
        }

        public void WriteManifest(string subjectPack, string version, string? humanSpec = null, string status = "active")
        {
            humanSpec ??= BuildCompiledHumanSpecPath(subjectPack, version);
            WriteJson(Path.Combine(Root, "prompts", subjectPack, "manifest.json"), new
            {
                kind = "subject-pack",
                assetId = subjectPack,
                version,
                status,
                sourceOfTruth = new
                {
                    humanSpec,
                    mirroredSpec = "./spec.md",
                    acceptanceChecklist = "./checklists/acceptance.md",
                    runtimeConfig = "./config.json"
                },
                entry = new
                {
                    snapshotCache = subjectPack == "math-answer"
                        ? "../../.snapshot-cache/resolved-snapshot.math.json"
                        : "../../.snapshot-cache/resolved-snapshot.json"
                },
                evaluation = new { resultsDir = $"../../eval/{subjectPack}/results" }
            });
        }

        public void WriteConfig(string subjectPack, string snapshotPath)
        {
            WriteJson(Path.Combine(Root, "prompts", subjectPack, "config.json"), new
            {
                snapshot = new { cachePath = snapshotPath }
            });
        }

        public void WriteSnapshot(string subjectPack, string version, string profile)
        {
            var snapshotFileName = subjectPack == "math-answer"
                ? "resolved-snapshot.math.json"
                : "resolved-snapshot.json";
            WriteJson(Path.Combine(Root, ".snapshot-cache", snapshotFileName), new
            {
                subjectPack = new { version },
                activeProfile = new { name = profile }
            });
        }

        public void WriteEval(string subjectPack, string assetVersion, bool ok, int caseCount)
        {
            WriteJson(Path.Combine(Root, "eval", subjectPack, "results", "latest.json"), new
            {
                assetVersion,
                ok,
                cases = Enumerable.Range(0, caseCount).Select(_ => new { }).ToArray()
            });
        }

        public void WriteAnswerMarkdown()
        {
            var answerPath = AnswerMarkdownPath;
            Directory.CreateDirectory(Path.GetDirectoryName(answerPath)!);
            File.WriteAllText(answerPath, "# sample answer\n");
        }

        public void WriteDeliveryManifest(string snapshotId)
        {
            WriteJson(Path.Combine(Root, "sample-answer.delivery-manifest.json"), new
            {
                schemaVersion = "1.0",
                kind = "delivery-manifest",
                generatedAt = "2026-06-18T00:00:00Z",
                subjectPack = "junior-physics-answer",
                snapshotId,
                snapshotPath = "../../.snapshot-cache/resolved-snapshot.json",
                snapshot = new
                {
                    id = snapshotId,
                    version = "v11.1",
                    profile = "classroom"
                },
                profile = "classroom",
                input = AnswerMarkdownPath,
                output = Path.ChangeExtension(AnswerMarkdownPath, ".pdf"),
                review = new
                {
                    outputDir = Path.Combine(Root, ".pdf-review", "sample-answer"),
                    manifestPath = Path.Combine(Root, ".pdf-review", "sample-answer", "manifest.json"),
                    scale = "2"
                }
            });
        }

        public void WriteSupportFiles()
        {
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "# bootstrap\n");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "# check\n");
            File.WriteAllText(Path.Combine(Root, "global.json"), "{}\n");
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "solution\n");
        }

        private static void WriteJson(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(value, Indented));
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
