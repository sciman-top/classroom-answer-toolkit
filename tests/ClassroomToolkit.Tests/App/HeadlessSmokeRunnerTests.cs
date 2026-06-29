using ClassroomToolkit.App.Services;
using ClassroomToolkit.Application.Abstractions;
using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Toolchain;
using FluentAssertions;
using System.Text.Json;

namespace ClassroomToolkit.Tests.App;

public sealed class HeadlessSmokeRunnerTests
{
    [Fact]
    public void Run_ReturnsWorkspaceAndDiagnosticsSummary()
    {
        var runner = new HeadlessSmokeRunner(new FakeToolchainOrchestrator(), new FakeDiagnosticsExporter());

        var result = runner.Run();

        result.RepositoryRoot.Should().Be(@"D:\repo");
        result.WorkspaceHealthy.Should().BeTrue();
        result.PrimarySubjectPack.Should().Be("physics-answer");
        result.SubjectPacks.Should().ContainSingle().Which.Should().Be("physics-answer");
        result.SnapshotPath.Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.json");
        result.LastSnapshotId.Should().BeNull();
        result.LastDeliverySubjectPack.Should().BeNull();
        result.LastDeliveryProfile.Should().BeNull();
        result.LastDeliverySnapshotPath.Should().BeNull();
        result.LastDeliverySnapshotVersion.Should().BeNull();
        result.LastDeliveryInputPath.Should().BeNull();
        result.LastDeliveryOutputPath.Should().BeNull();
        result.LastDeliveryReviewDirectoryPath.Should().BeNull();
        result.DiagnosticsBundlePath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001");
        result.DiagnosticsManifestPath.Should().Be(@"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json");
        result.DiagnosticsFileCount.Should().Be(3);
    }

    [Fact]
    public void Run_UsesWorkspaceDiagnosticsExporter()
    {
        var exporter = new FakeDiagnosticsExporter();
        var runner = new HeadlessSmokeRunner(new FakeToolchainOrchestrator(), exporter);

        runner.Run();

        exporter.LastRequest.Should().NotBeNull();
        exporter.LastRequest!.RepositoryRoot.Should().Be(@"D:\repo");
        exporter.LastRequest.HealthReport.IsHealthy.Should().BeTrue();
    }

    [Fact]
    public void Run_ReadsLastDeliveryContext_FromDiagnosticsManifest()
    {
        using var root = new TemporaryDirectory();
        var bundlePath = Path.Combine(root.Path, "artifacts", "diagnostics", "bundle-001");
        Directory.CreateDirectory(bundlePath);
        var manifestPath = Path.Combine(bundlePath, "diagnostic-manifest.json");
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
        {
            lastDeliveryContext = new
            {
                subjectPack = "math-answer",
                profile = "compact",
                snapshotId = "snapshot-math",
                snapshotPath = @"D:\repo\.snapshot-cache\resolved-snapshot.math.json",
                snapshotVersion = "v0.1",
                input = @"D:\repo\习题PDF\sample-answer.md",
                output = @"D:\repo\习题PDF\sample-answer.pdf",
                reviewDirectoryPath = @"D:\repo\.pdf-review\sample-answer"
            }
        }));

        var runner = new HeadlessSmokeRunner(
            new FakeToolchainOrchestrator(),
            new FakeDiagnosticsExporter(bundlePath, manifestPath, 4));

        var result = runner.Run();

        result.LastDeliverySubjectPack.Should().Be("math-answer");
        result.LastDeliveryProfile.Should().Be("compact");
        result.LastSnapshotId.Should().Be("snapshot-math");
        result.LastDeliverySnapshotPath.Should().Be(@"D:\repo\.snapshot-cache\resolved-snapshot.math.json");
        result.LastDeliverySnapshotVersion.Should().Be("v0.1");
        result.LastDeliveryInputPath.Should().Be(@"D:\repo\习题PDF\sample-answer.md");
        result.LastDeliveryOutputPath.Should().Be(@"D:\repo\习题PDF\sample-answer.pdf");
        result.LastDeliveryReviewDirectoryPath.Should().Be(@"D:\repo\.pdf-review\sample-answer");
    }

    [Fact]
    public void Run_IgnoresNullLastDeliveryContext_InDiagnosticsManifest()
    {
        using var root = new TemporaryDirectory();
        var bundlePath = Path.Combine(root.Path, "artifacts", "diagnostics", "bundle-001");
        Directory.CreateDirectory(bundlePath);
        var manifestPath = Path.Combine(bundlePath, "diagnostic-manifest.json");
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
        {
            lastDeliveryContext = (object?)null
        }));

        var runner = new HeadlessSmokeRunner(
            new FakeToolchainOrchestrator(),
            new FakeDiagnosticsExporter(bundlePath, manifestPath, 4));

        var result = runner.Run();

        result.LastDeliverySubjectPack.Should().BeNull();
        result.LastDeliveryProfile.Should().BeNull();
        result.LastSnapshotId.Should().BeNull();
        result.LastDeliverySnapshotPath.Should().BeNull();
        result.LastDeliverySnapshotVersion.Should().BeNull();
        result.LastDeliveryInputPath.Should().BeNull();
        result.LastDeliveryOutputPath.Should().BeNull();
        result.LastDeliveryReviewDirectoryPath.Should().BeNull();
    }

    private sealed class FakeToolchainOrchestrator : IToolchainOrchestrator
    {
        public ToolchainWorkspaceInfo GetWorkspaceInfo()
        {
            return new ToolchainWorkspaceInfo(
                @"D:\repo",
                @"D:\repo\scripts\bootstrap.ps1",
                @"D:\repo\scripts\check-toolchain.ps1",
                BootstrapScriptExists: true,
                CheckScriptExists: true,
                PrimarySubjectPack: "physics-answer",
                SubjectPacks: ["physics-answer"]);
        }

        public WorkspaceHealthReport GetWorkspaceHealthReport()
        {
            return new WorkspaceHealthReport(
                "physics-answer",
                ["physics-answer"],
                "v11.2",
                "v11.2",
                SnapshotExists: true,
                SnapshotPath: @"D:\repo\.snapshot-cache\resolved-snapshot.json",
                SnapshotVersion: "v11.2",
                SnapshotProfile: "classroom",
                EvalExists: true,
                EvalOk: true,
                EvalCaseCount: 6,
                GraphicsExists: true,
                GraphicsSummary: "graphics ready",
                Summary: "workspace healthy",
                Issues: Array.Empty<string>());
        }

        public Task<ToolchainExecutionResult> RunBootstrapAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(ToolchainExecutionResult.Success(ToolchainScriptKind.Bootstrap, @"D:\repo\scripts\bootstrap.ps1", DateTimeOffset.Now, DateTimeOffset.Now, string.Empty));
        }

        public Task<ToolchainExecutionResult> RunCheckAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(ToolchainExecutionResult.Success(ToolchainScriptKind.Check, @"D:\repo\scripts\check-toolchain.ps1", DateTimeOffset.Now, DateTimeOffset.Now, string.Empty));
        }

        public Task<(ToolchainExecutionResult Execution, AnswerDeliveryResult? Delivery)> RunDeliverAsync(
            AnswerDeliveryRequest request,
            CancellationToken cancellationToken = default)
        {
            throw new NotSupportedException();
        }
    }

    private sealed class FakeDiagnosticsExporter : IWorkspaceDiagnosticsExporter
    {
        private readonly string _bundlePath;
        private readonly string _manifestPath;
        private readonly int _fileCount;

        public FakeDiagnosticsExporter(
            string bundlePath = @"D:\repo\artifacts\diagnostics\bundle-001",
            string manifestPath = @"D:\repo\artifacts\diagnostics\bundle-001\diagnostic-manifest.json",
            int fileCount = 3)
        {
            _bundlePath = bundlePath;
            _manifestPath = manifestPath;
            _fileCount = fileCount;
        }

        public WorkspaceDiagnosticsExportRequest? LastRequest { get; private set; }

        public WorkspaceDiagnosticsExportResult Export(WorkspaceDiagnosticsExportRequest request)
        {
            LastRequest = request;
            return new WorkspaceDiagnosticsExportResult(
                _bundlePath,
                _manifestPath,
                _fileCount);
        }
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ClassroomToolkit-Smoke", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            if (Directory.Exists(Path))
            {
                Directory.Delete(Path, recursive: true);
            }
        }
    }
}
