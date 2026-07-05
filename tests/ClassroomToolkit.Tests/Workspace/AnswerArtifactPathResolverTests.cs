using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class AnswerArtifactPathResolverTests
{
    [Fact]
    public void ResolveOutputPdfPath_UsesMarkdownStem_WhenExplicitPathIsMissing()
    {
        var markdownPath = @"D:\repo\样例交付\sample-answer.md";

        var result = AnswerArtifactPathResolver.ResolveOutputPdfPath(markdownPath, null);

        result.Should().Be(@"D:\repo\样例交付\sample-answer.pdf");
    }

    [Fact]
    public void ResolveReviewDirectoryPath_MapsPdfPathIntoPdfReviewFolder()
    {
        var repositoryRoot = @"D:\repo";
        var outputPdfPath = @"D:\repo\样例交付\folder\sample-answer.pdf";

        var result = AnswerArtifactPathResolver.ResolveReviewDirectoryPath(repositoryRoot, outputPdfPath);

        result.Should().Be(@"D:\repo\.pdf-review\样例交付_folder__sample-answer");
    }

    [Fact]
    public void ResolveDeliveryManifestPath_UsesPdfStemWithDeliveryManifestSuffix()
    {
        var outputPdfPath = @"D:\repo\样例交付\folder\sample-answer.pdf";

        var result = AnswerArtifactPathResolver.ResolveDeliveryManifestPath(outputPdfPath);

        result.Should().Be(@"D:\repo\样例交付\folder\sample-answer.delivery-manifest.json");
    }
}
