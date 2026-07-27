using ClassroomToolkit.Domain.Review;
using ClassroomToolkit.Infra.Process;
using ClassroomToolkit.Infra.Workspace;
using ClassroomToolkit.Services.Toolchain;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class ReviewQueueProjectionIntegrationTests
{
    [Fact]
    public async Task ProjectorAdapter_UsesRealNodeProcess_AndReturnsHashBoundQueues()
    {
        var repositoryRoot = FindRepoRoot();
        var feedbackPath = Path.Combine(
            repositoryRoot,
            "eval",
            "sample-flywheel",
            "cases",
            "synthetic-teacher-feedback",
            "ambiguous-reasoning-format.feedback-parse-result.json");
        var decisionPath = Path.Combine(
            repositoryRoot,
            "eval",
            "visual-evidence",
            "cases",
            "visual-risk",
            "math-ocr-image-conflict.decision-record.json");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(repositoryRootOverride: repositoryRoot),
            new PowerShellProcessRunner());

        var result = await orchestrator.ProjectReviewQueueAsync(
            new ReviewQueueProjectionRequest([decisionPath, feedbackPath]));

        result.Execution.Succeeded.Should().BeTrue(result.Execution.Output);
        result.Projection.Should().NotBeNull();
        result.Projection!.Succeeded.Should().BeTrue();
        result.Projection.Authority.Should().Be("local_verified_projection");
        result.Projection.NeedsHumanLabelCount.Should().Be(1);
        result.Projection.HighRiskApprovalCount.Should().Be(1);
        result.Projection.TruthNeedsReviewCount.Should().Be(0);
        result.Projection.Items.Should().HaveCount(2);
        result.Projection.Items.Should().OnlyContain(item => item.SourceSha256.Length == 64);
    }

    [Fact]
    public async Task ProjectorAdapter_PreservesFailClosedRejectedProjection()
    {
        var repositoryRoot = FindRepoRoot();
        var feedbackPath = Path.Combine(
            repositoryRoot,
            "eval",
            "sample-flywheel",
            "cases",
            "synthetic-teacher-feedback",
            "ambiguous-reasoning-format.feedback-parse-result.json");
        var orchestrator = new LocalToolchainOrchestrator(
            new RepositoryRootResolver(repositoryRootOverride: repositoryRoot),
            new PowerShellProcessRunner());

        var result = await orchestrator.ProjectReviewQueueAsync(
            new ReviewQueueProjectionRequest([feedbackPath, feedbackPath]));

        result.Execution.Succeeded.Should().BeTrue(result.Execution.Output);
        result.Projection.Should().NotBeNull();
        result.Projection!.Succeeded.Should().BeFalse();
        result.Projection.Items.Should().BeEmpty();
        result.Projection.RejectedSources.Should().ContainSingle();
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))
                && Directory.Exists(Path.Combine(current.FullName, "tools", "review-queue")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}
