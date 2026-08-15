using System.Text.Json;
using ClassroomToolkit.App.Services;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Infra.Abstractions;
using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class LocalToolchainOrchestratorTests
{
    [Fact]
    public async Task DeliverInvokesRendererAndReadsManifest()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            workspace.MarkdownPath, workspace.PdfPath, "classroom", true, "junior-physics-answer"));

        execution.Succeeded.Should().BeTrue();
        delivery.Should().NotBeNull();
        delivery!.SnapshotId.Should().Be("snapshot-test");
        delivery.ReviewDirectoryPath.Should().Be(Path.Combine(workspace.Root, ".pdf-review", "answer"));
        runner.Arguments.Should().Contain("deliver");
        runner.Arguments.Should().Contain("--keep-review");
    }

    [Fact]
    public async Task DeliverRejectsMissingMarkdownBeforeProcessStart()
    {
        using var workspace = new TemporaryWorkspace();
        var runner = new DeliveryRunner(workspace.Root);
        var orchestrator = new LocalToolchainOrchestrator(new RepositoryRootResolver(workspace.Root), runner);

        var (execution, delivery) = await orchestrator.RunDeliverAsync(new AnswerDeliveryRequest(
            Path.Combine(workspace.Root, "missing.md"), null, "classroom", false));

        execution.Succeeded.Should().BeFalse();
        delivery.Should().BeNull();
        runner.CallCount.Should().Be(0);
    }

    private sealed class DeliveryRunner : IProcessRunner
    {
        private readonly string _root;
        public DeliveryRunner(string root) => _root = root;
        public IReadOnlyList<string> Arguments { get; private set; } = [];
        public int CallCount { get; private set; }

        public Task<ProcessRunResult> RunAsync(string fileName, IReadOnlyList<string> arguments, string workingDirectory, CancellationToken cancellationToken = default)
        {
            CallCount += 1;
            Arguments = arguments;
            var pdfPath = arguments[6];
            var manifestPath = Path.Combine(Path.GetDirectoryName(pdfPath)!, $"{Path.GetFileNameWithoutExtension(pdfPath)}.delivery-manifest.json");
            File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
            {
                snapshotId = "snapshot-test",
                snapshotPath = ".snapshot-cache/resolved-snapshot.json",
                snapshot = new { version = "v8.14" },
                profile = "classroom",
                review = new
                {
                    outputDir = Path.Combine(_root, ".pdf-review", "answer")
                }
            }));
            return Task.FromResult(new ProcessRunResult(0, "ok", "", TimeSpan.Zero));
        }
    }

    private sealed class TemporaryWorkspace : IDisposable
    {
        public TemporaryWorkspace()
        {
            Root = Path.Combine(Path.GetTempPath(), $"classroom-toolkit-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path.Combine(Root, "scripts"));
            Directory.CreateDirectory(Path.Combine(Root, "tools", "latex-renderer"));
            Directory.CreateDirectory(Path.Combine(Root, "prompts", "junior-physics-answer"));
            File.WriteAllText(Path.Combine(Root, "ClassroomToolkit.sln"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "bootstrap.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "scripts", "check-toolchain.ps1"), "");
            File.WriteAllText(Path.Combine(Root, "tools", "latex-renderer", "deliver-answer.mjs"), "");
            File.WriteAllText(Path.Combine(Root, "prompts", "junior-physics-answer", "manifest.json"), "{\"assetId\":\"junior-physics-answer\",\"kind\":\"subject-pack\"}");
            File.WriteAllText(Path.Combine(Root, "prompts", "junior-physics-answer", "config.json"), "{\"snapshot\":{\"cachePath\":\"../../.snapshot-cache/resolved-snapshot.json\"}}");
            MarkdownPath = Path.Combine(Root, "answer.md");
            PdfPath = Path.Combine(Root, "answer.pdf");
            File.WriteAllText(MarkdownPath, "# 答案");
        }

        public string Root { get; }
        public string MarkdownPath { get; }
        public string PdfPath { get; }
        public void Dispose() => Directory.Delete(Root, true);
    }
}
