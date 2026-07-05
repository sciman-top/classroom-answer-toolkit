using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Fact]
    public void MathSubjectPack_ProvidesMinimalContractAssets()
    {
        var repoRoot = FindRepoRoot();

        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "manifest.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "config.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "profiles", "classroom.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "rules", "math-format.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "dataset.json")).Should().BeTrue();
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
