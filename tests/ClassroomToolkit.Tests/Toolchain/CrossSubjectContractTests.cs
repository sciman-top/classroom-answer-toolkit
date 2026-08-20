using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Theory]
    [InlineData("junior-physics-answer", "v8.16")]
    [InlineData("senior-physics-answer", "v1.1")]
    [InlineData("math-answer", "v0.2")]
    public void SubjectPackManifestDatasetAndMirroredSpecAreAligned(string subjectPack, string expectedVersion)
    {
        var root = FindRepoRoot();
        var packRoot = Path.Combine(root, "prompts", subjectPack);
        var manifestPath = Path.Combine(packRoot, "manifest.json");
        using var manifestDocument = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var manifest = manifestDocument.RootElement;

        manifest.GetProperty("kind").GetString().Should().Be("subject-pack");
        manifest.GetProperty("version").GetString().Should().Be(expectedVersion);
        Directory.Exists(Path.Combine(packRoot, "rules")).Should().BeTrue();

        var datasetPath = Path.GetFullPath(Path.Combine(
            packRoot,
            manifest.GetProperty("evaluation").GetProperty("dataset").GetString()!));
        using var datasetDocument = JsonDocument.Parse(File.ReadAllText(datasetPath));
        datasetDocument.RootElement.GetProperty("assetVersion").GetString().Should().Be(expectedVersion);

        var source = manifest.GetProperty("sourceOfTruth");
        var humanSpec = Path.GetFullPath(Path.Combine(packRoot, source.GetProperty("humanSpec").GetString()!));
        var mirroredSpec = Path.GetFullPath(Path.Combine(packRoot, source.GetProperty("mirroredSpec").GetString()!));
        File.ReadAllBytes(mirroredSpec).Should().Equal(File.ReadAllBytes(humanSpec));
    }

    [Fact]
    public void PhysicsEvalSuitesDeclareOneSharedRendererOwnerAndBoundedSeniorSentinels()
    {
        var root = FindRepoRoot();
        using var juniorDocument = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            root, "eval", "junior-physics-answer", "dataset.json")));
        using var seniorDocument = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            root, "eval", "senior-physics-answer", "dataset.json")));

        juniorDocument.RootElement.GetProperty("coverageRole").GetString()
            .Should().Be("shared-renderer-and-primary-subject");
        seniorDocument.RootElement.GetProperty("coverageRole").GetString()
            .Should().Be("subject-pack-sentinel");
        seniorDocument.RootElement.GetProperty("sharedRendererContractSuite").GetString()
            .Should().Be("junior-physics-answer");

        seniorDocument.RootElement.GetProperty("cases")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetString())
            .Should().BeEquivalentTo(["smoke-answer"]);
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))) return current.FullName;
            current = current.Parent;
        }

        throw new InvalidOperationException("Repository root not found.");
    }
}
