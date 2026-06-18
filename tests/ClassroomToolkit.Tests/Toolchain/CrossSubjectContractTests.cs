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
    public void CheckToolchain_InvokesMathAnswerEval()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "check-toolchain.ps1"));

        script.Should().Contain("npm --prefix tools/latex-renderer run eval:math");
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
