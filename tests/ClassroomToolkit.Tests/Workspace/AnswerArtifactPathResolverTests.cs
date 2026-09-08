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
    public void ResolveDeliveryManifestPath_UsesPdfStemWithDeliveryManifestSuffix()
    {
        var outputPdfPath = @"D:\repo\样例交付\folder\sample-answer.pdf";

        var result = AnswerArtifactPathResolver.ResolveDeliveryManifestPath(outputPdfPath);

        result.Should().Be(@"D:\repo\样例交付\folder\sample-answer.delivery-manifest.json");
    }

    [Fact]
    public void ResolveUserPath_ResolvesRelativeInputAgainstBaseDirectory()
    {
        var result = AnswerArtifactPathResolver.ResolveUserPath(@"notes\答案.md", @"D:\repo");

        result.Should().Be(@"D:\repo\notes\答案.md");
    }

    [Fact]
    public void ResolveUserPath_KeepsAbsoluteInputUntouched()
    {
        var result = AnswerArtifactPathResolver.ResolveUserPath(@"D:\elsewhere\答案.md", @"D:\repo");

        result.Should().Be(@"D:\elsewhere\答案.md");
    }

    [Fact]
    public void ResolveOutputPdfPath_ResolvesRelativeExplicitPathAgainstBaseDirectory()
    {
        var markdownPath = @"D:\repo\notes\sample-answer.md";

        var result = AnswerArtifactPathResolver.ResolveOutputPdfPath(
            markdownPath, @"out\sample-answer.pdf", baseDirectory: @"D:\repo");

        result.Should().Be(@"D:\repo\out\sample-answer.pdf");
    }
}
