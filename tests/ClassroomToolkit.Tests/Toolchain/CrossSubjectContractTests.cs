using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Theory]
    [InlineData("junior-physics-answer", "v8.15")]
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
    public void RepositoryUsesCompatibleDotNetFeatureBand()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(FindRepoRoot(), "global.json")));
        var sdk = document.RootElement.GetProperty("sdk");

        sdk.GetProperty("version").GetString().Should().Be("10.0.300");
        sdk.GetProperty("rollForward").GetString().Should().Be("latestPatch");
        sdk.GetProperty("allowPrerelease").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public void FrozenSurfacesAreAbsentFromTheActiveTree()
    {
        var root = FindRepoRoot();
        var removedEntrypoints = new[]
        {
            "tools/answer-generator/package.json",
            "tools/answer-graphics/package.json",
            "tools/review-queue/package.json",
            "tools/sample-flywheel/package.json",
            "tools/track-orchestrator/package.json",
            "tools/visual-evidence/package.json",
            "src/ClassroomToolkit.Interop/ClassroomToolkit.Interop.csproj"
        };

        removedEntrypoints
            .Select(path => Path.Combine(root, path.Replace('/', Path.DirectorySeparatorChar)))
            .Should()
            .OnlyContain(path => !File.Exists(path));

        Directory.GetFiles(Path.Combine(root, "prompts", "shared", "schemas"), "*.schema.json")
            .Should()
            .HaveCount(12);
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
