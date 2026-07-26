using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Infra.Process;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class AggregateAttachmentVerificationIntegrationTests
{
    [Fact]
    public async Task VerifierAdapter_UsesRealNodeProcess_AgainstSyntheticAttachedFixture()
    {
        var repositoryRoot = FindRepoRoot();
        using var workspace = new SyntheticFixtureWorkspace(repositoryRoot);
        var processRunner = new PowerShellProcessRunner();
        var attachToolPath = Path.Combine(
            repositoryRoot,
            "tools",
            "visual-evidence",
            "attach-delivery-decision-aggregate.mjs");
        var attachResult = await processRunner.RunAsync(
            "node",
            [
                attachToolPath,
                "--manifest",
                workspace.ManifestPath,
                "--aggregate",
                workspace.AggregatePath
            ],
            repositoryRoot);
        attachResult.ExitCode.Should().Be(0, attachResult.StandardError);

        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(repositoryRootOverride: repositoryRoot),
            processRunner);

        var result = await orchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync(
            new DeliveryDecisionAggregateAttachmentVerificationRequest(workspace.ManifestPath));

        result.Execution.Succeeded.Should().BeTrue(result.Execution.Output);
        result.Verification.Should().NotBeNull();
        result.Verification!.ManifestPath.Should().Be(workspace.ManifestPath);
        result.Verification.AggregatePath.Should().Be(workspace.AggregatePath);
        result.Verification.VisualReviewPassed.Should().BeTrue();
        result.Verification.Trusted.Should().BeTrue();
        result.Delivery.Should().NotBeNull();
        result.Delivery!.VisualReviewPassed.Should().BeTrue();
        result.Delivery.Trusted.Should().BeTrue();
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))
                && Directory.Exists(Path.Combine(current.FullName, "tools", "visual-evidence")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Repository root not found.");
    }

    private sealed class SyntheticFixtureWorkspace : IDisposable
    {
        public SyntheticFixtureWorkspace(string repositoryRoot)
        {
            Root = Path.Combine(
                Path.GetTempPath(),
                "ClassroomToolkit-AggregateVerifier",
                Guid.NewGuid().ToString("N"));
            var fixtureRoot = Path.Combine(
                repositoryRoot,
                "eval",
                "visual-evidence",
                "cases",
                "delivery-aggregate");
            CopyDirectory(fixtureRoot, Root);
        }

        public string Root { get; }

        public string ManifestPath => Path.Combine(Root, "synthetic.delivery-manifest.json");

        public string AggregatePath => Path.Combine(Root, "synthetic.delivery-decision-aggregate.json");

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }

        private static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (var sourcePath in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                var relativePath = Path.GetRelativePath(source, sourcePath);
                var destinationPath = Path.Combine(destination, relativePath);
                Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                File.Copy(sourcePath, destinationPath);
            }
        }
    }
}
