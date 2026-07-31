using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Theory]
    [InlineData("junior-physics-answer")]
    [InlineData("senior-physics-answer")]
    [InlineData("math-answer")]
    public void SubjectPackHasPromptRulesAndEvalDataset(string subjectPack)
    {
        var root = FindRepoRoot();
        var manifestPath = Path.Combine(root, "prompts", subjectPack, "manifest.json");
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var manifest = document.RootElement;

        manifest.GetProperty("kind").GetString().Should().Be("subject-pack");
        Directory.Exists(Path.Combine(root, "prompts", subjectPack, "rules")).Should().BeTrue();
        File.Exists(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(manifestPath)!, manifest.GetProperty("evaluation").GetProperty("dataset").GetString()!))).Should().BeTrue();
    }

    [Fact]
    public void JuniorPhysicsUsesV814CompiledPromptAsRuntimeSpec()
    {
        var root = FindRepoRoot();
        var manifestPath = Path.Combine(root, "prompts", "junior-physics-answer", "manifest.json");
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var source = document.RootElement.GetProperty("sourceOfTruth");
        var humanSpec = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(manifestPath)!, source.GetProperty("humanSpec").GetString()!));
        var mirroredSpec = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(manifestPath)!, source.GetProperty("mirroredSpec").GetString()!));

        document.RootElement.GetProperty("version").GetString().Should().Be("v8.14");
        File.ReadAllBytes(mirroredSpec).Should().Equal(File.ReadAllBytes(humanSpec));
    }

    [Fact]
    public void AssetGateChecksCompiledPromptsAndSnapshots()
    {
        var script = File.ReadAllText(Path.Combine(FindRepoRoot(), "tools", "rule-compiler", "validate-assets.mjs"));

        script.Should().Contain("checkAssemblyOutputs");
        script.Should().Contain("compileResolvedSnapshot");
        script.Should().Contain("renderer-contract.schema.json");
        script.Should().NotContain("sample-flywheel");
        script.Should().NotContain("visual-evidence");
    }

    [Fact]
    public void LiveAnswerGenerationRequiresExplicitCloudEgress()
    {
        var script = File.ReadAllText(Path.Combine(FindRepoRoot(), "tools", "ai-gateway", "answer-request.mjs"));

        script.Should().Contain("--allow-cloud-egress");
        script.Should().Contain("assertLiveEgressAllowed");
        script.Should().Contain("prompts\", \"junior-physics-answer\", \"spec.md");
    }

    [Fact]
    public void ToolchainGateTargetsOnlyAnswerGenerationAndLayoutCore()
    {
        var script = File.ReadAllText(Path.Combine(FindRepoRoot(), "scripts", "check-toolchain.ps1"));

        script.Should().Contain("test:answer");
        script.Should().Contain("validate:assets");
        script.Should().Contain("latex-renderer run smoke");
        script.Should().Contain("eval-answer-fixtures.mjs");
        script.Should().NotContain("sample-flywheel");
        script.Should().NotContain("visual-evidence");
        script.Should().NotContain("answer-graphics");
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
