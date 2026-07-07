using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Fact]
    public void MathSubjectPack_ProvidesMinimalContractAssets()
    {
        var repoRoot = FindRepoRoot();
        var manifestPath = Path.Combine(repoRoot, "prompts", "math-answer", "manifest.json");
        var configPath = Path.Combine(repoRoot, "prompts", "math-answer", "config.json");

        File.Exists(manifestPath).Should().BeTrue();
        File.Exists(configPath).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "spec.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "checklists", "acceptance.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "profiles", "classroom.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "rules", "math-format.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "specs", "assemblies", "math.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "specs", "compiled", "试卷参考答案交付规范-初中数学-完整版-v0.1.md")).Should().BeTrue();
        var datasetPath = Path.Combine(repoRoot, "eval", "math-answer", "dataset.json");
        File.Exists(datasetPath).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "stepwise-derivation.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "stepwise-derivation.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "stepwise-derivation.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "stepwise-derivation.compact.page-001.png")).Should().BeTrue();

        using var dataset = JsonDocument.Parse(File.ReadAllText(datasetPath));
        var caseIds = dataset.RootElement.GetProperty("cases").EnumerateArray()
            .Select(static element => element.GetProperty("id").GetString())
            .ToArray();
        caseIds.Should().Contain("stepwise-derivation");

        using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
        manifest.RootElement.GetProperty("status").GetString().Should().Be("experimental");
        var manifestSourceOfTruth = manifest.RootElement.GetProperty("sourceOfTruth");
        manifestSourceOfTruth.GetProperty("humanSpec").GetString().Should().Be("../specs/compiled/试卷参考答案交付规范-初中数学-完整版-v0.1.md");
        manifestSourceOfTruth.GetProperty("mirroredSpec").GetString().Should().Be("./spec.md");
        manifestSourceOfTruth.GetProperty("acceptanceChecklist").GetString().Should().Be("./checklists/acceptance.md");
        manifestSourceOfTruth.GetProperty("runtimeConfig").GetString().Should().Be("./config.json");
        manifest.RootElement.GetProperty("evaluation").GetProperty("visualBaselinesDir").GetString().Should().Be("../../eval/math-answer/baselines/visual");
        var tooling = manifest.RootElement.GetProperty("tooling");
        tooling.GetProperty("evalRunner").GetString().Should().Be("../../tools/latex-renderer/eval-answer-fixtures.mjs");
        tooling.GetProperty("renderer").GetString().Should().Be("../../tools/latex-renderer/render-md-latex.mjs");
        tooling.GetProperty("deliver").GetString().Should().Be("../../tools/latex-renderer/deliver-answer.mjs");
        tooling.GetProperty("visualSmoke").GetString().Should().Be("../../tools/latex-renderer/visual-regression-smoke.mjs");

        using var config = JsonDocument.Parse(File.ReadAllText(configPath));
        var configSourceOfTruth = config.RootElement.GetProperty("sourceOfTruth");
        configSourceOfTruth.GetProperty("humanSpec").GetString().Should().Be("../specs/compiled/试卷参考答案交付规范-初中数学-完整版-v0.1.md");
        configSourceOfTruth.GetProperty("mirroredSpec").GetString().Should().Be("./spec.md");
        configSourceOfTruth.GetProperty("acceptanceChecklist").GetString().Should().Be("./checklists/acceptance.md");
        config.RootElement.GetProperty("evaluation").GetProperty("visualBaselinesDir").GetString().Should().Be("../../eval/math-answer/baselines/visual");
    }

    [Fact]
    public void AssetValidationScript_RequiresAssemblyCoverage_ForEverySubjectPack()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "validate-assets.mjs"));

        script.Should().Contain("is missing prompts/specs/assemblies coverage");
        script.Should().Contain("is referenced by multiple assemblies");
    }

    [Fact]
    public void RuleCompiler_ExposesCrossSubjectValidationScript()
    {
        var repoRoot = FindRepoRoot();
        var packageJson = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "package.json"));

        packageJson.Should().Contain("validate:cross-subject");
    }

    [Fact]
    public void SubjectPackToolingScript_ExposesSharedSubjectPackDiscovery()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "subject-pack-tooling.ps1"));

        script.Should().Contain("function Get-SubjectPackMetadata");
        script.Should().Contain("manifest.json");
        script.Should().Contain("function Get-SubjectPackSnapshotOutputPath");
        script.Should().Contain("snapshot.cachePath");
    }

    [Fact]
    public void CheckToolchain_UsesDiscoveredSubjectPacks_ForSnapshotsAndEval()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "check-toolchain.ps1"));

        script.Should().Contain("Get-SubjectPackMetadata -RepositoryRoot $repoRoot");
        script.Should().Contain("Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile");
        script.Should().Contain("node tools/latex-renderer/eval-answer-fixtures.mjs --subject-pack $subjectPack.AssetId");
    }

    [Fact]
    public void Bootstrap_UsesDiscoveredSubjectPacks_ForSnapshotCompilation()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "bootstrap.ps1"));

        script.Should().Contain("Get-SubjectPackMetadata -RepositoryRoot $repoRoot");
        script.Should().Contain("Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile");
    }

    [Fact]
    public void Bootstrap_ChecksDotNetSdkAcrossInstalledSdkLines_AndTreatsAnswerGraphicsAsOnDemand()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "bootstrap.ps1"));

        script.Should().Contain("$sdkOutput -split [Environment]::NewLine");
        script.Should().Contain("Where-Object { $_ -match ('^{0}\\s+\\[' -f [regex]::Escape($Version)) }");
        script.Should().Contain("Test-DotNetSdkInstalled -Version \"10.0.301\"");
        script.Should().Contain("Skipping tools/answer-graphics bootstrap; this experimental toolchain is installed on demand.");
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Repository root not found.");
    }
}
