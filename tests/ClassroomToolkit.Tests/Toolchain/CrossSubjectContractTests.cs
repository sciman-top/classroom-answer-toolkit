using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Theory]
    [InlineData("junior-physics-answer")]
    [InlineData("senior-physics-answer")]
    [InlineData("math-answer")]
    public void SubjectPackManifestDatasetAndCompiledSpecAreAligned(string subjectPack)
    {
        var root = FindRepoRoot();
        var packRoot = Path.Combine(root, "prompts", subjectPack);
        var manifestPath = Path.Combine(packRoot, "manifest.json");
        using var manifestDocument = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var manifest = manifestDocument.RootElement;

        manifest.GetProperty("kind").GetString().Should().Be("subject-pack");
        // The aligned version is whatever the manifest declares; hardcoding it
        // here would turn every spec version bump into a test edit.
        var manifestVersion = manifest.GetProperty("version").GetString();
        manifestVersion.Should().NotBeNullOrWhiteSpace();
        Directory.Exists(Path.Combine(packRoot, "rules")).Should().BeTrue();

        var datasetPath = Path.GetFullPath(Path.Combine(
            packRoot,
            manifest.GetProperty("evaluation").GetProperty("dataset").GetString()!));
        using var datasetDocument = JsonDocument.Parse(File.ReadAllText(datasetPath));
        datasetDocument.RootElement.GetProperty("assetVersion").GetString().Should().Be(manifestVersion);

        var source = manifest.GetProperty("sourceOfTruth");
        var humanSpec = Path.GetFullPath(Path.Combine(packRoot, source.GetProperty("humanSpec").GetString()!));
        File.Exists(humanSpec).Should().BeTrue();
        humanSpec.Replace('\\', '/').Should().Contain("prompts/specs/compiled/");
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

    [Fact]
    public void NodeVersionContractIsDeclaredConsistentlyAcrossToolPackages()
    {
        var root = FindRepoRoot();
        var declaredVersion = File.ReadAllText(Path.Combine(root, ".node-version")).Trim();
        declaredVersion.Should().MatchRegex(@"^\d+$");

        // The workflow's -UseGatewayProxy path needs Node 24+ (--use-env-proxy),
        // so every tool package must declare the same floor as .node-version
        // instead of relying on whatever happens to be on PATH.
        foreach (var tool in new[] { "ai-gateway", "latex-renderer", "rule-compiler", "spec-assembler" })
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(
                root, "tools", tool, "package.json")));
            document.RootElement.GetProperty("engines").GetProperty("node").GetString()
                .Should().Be($">={declaredVersion}", $"{tool} must match .node-version");
        }
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
