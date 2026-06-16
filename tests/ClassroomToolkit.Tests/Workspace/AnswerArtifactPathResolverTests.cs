using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class AnswerArtifactPathResolverTests
{
    [Fact]
    public void ResolveOutputPdfPath_UsesMarkdownStem_WhenExplicitPathIsMissing()
    {
        var markdownPath = @"D:\repo\习题PDF\sample-answer.md";

        var result = AnswerArtifactPathResolver.ResolveOutputPdfPath(markdownPath, null);

        result.Should().Be(@"D:\repo\习题PDF\sample-answer.pdf");
    }

    [Fact]
    public void ResolveReviewDirectoryPath_MapsPdfPathIntoPdfReviewFolder()
    {
        var repositoryRoot = @"D:\repo";
        var outputPdfPath = @"D:\repo\习题PDF\folder\sample-answer.pdf";

        var result = AnswerArtifactPathResolver.ResolveReviewDirectoryPath(repositoryRoot, outputPdfPath);

        result.Should().Be(@"D:\repo\.pdf-review\习题PDF_folder__sample-answer");
    }
}
