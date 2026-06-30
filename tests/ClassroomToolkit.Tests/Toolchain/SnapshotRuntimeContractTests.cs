using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class SnapshotRuntimeContractTests
{
    [Fact]
    public void ValidatorRenderAndDeliverRuntime_DoNotReadConfigOrProfileAssetsDirectly()
    {
        var repoRoot = FindRepoRoot();
        var runtimeFiles = new[]
        {
            "tools/latex-renderer/validate-answer-markdown.mjs",
            "tools/latex-renderer/render-md-latex.mjs",
            "tools/latex-renderer/deliver-answer.mjs"
        };

        foreach (var relativePath in runtimeFiles)
        {
            var script = File.ReadAllText(Path.Combine(repoRoot, relativePath));

            script.Should().NotContain("loadRuntimeConfig(");
            script.Should().NotContain("getDefaultProfileName(");
            script.Should().NotContain("prompts\", subjectPack, \"profiles");
            script.Should().NotContain("config.snapshot");
            script.Should().Contain("snapshot");
        }
    }

    [Fact]
    public void ValidatorRoutesFindingsThroughSnapshotRuleSeverity()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/validate-answer-markdown.mjs"));

        script.Should().Contain("resolveValidationRules(snapshot)");
        script.Should().Contain("findEnabledRule(snapshot");
        script.Should().Contain("rule?.severity === \"hard\"");
        script.Should().Contain("physics-answer.choice-answer.compact-line");
        script.Should().Contain("rendering.true-latex");
    }

    [Fact]
    public void RenderProfileLoader_UsesSnapshotActiveProfile()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/render-profiles.mjs"));

        script.Should().Contain("getSnapshotActiveProfile(snapshot");
        script.Should().NotContain("loadRuntimeConfig(");
        script.Should().NotContain("getPromptProfilesDir");
        script.Should().NotContain("fs.readFileSync");
    }

    [Fact]
    public void DeliveryManifestWriter_RequiresSnapshotIdentityInsteadOfCliFallback()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/write-delivery-manifest.mjs"));

        script.Should().Contain("loadRequiredResolvedSnapshot(snapshotPath)");
        script.Should().Contain("Resolved snapshot is missing snapshotId");
        script.Should().Contain("Resolved snapshot is missing activeProfile.name");
        script.Should().Contain("Resolved snapshot is missing subjectPack.assetId");
        script.Should().Contain("Resolved snapshot is missing subjectPack.version");
        script.Should().NotContain("snapshot?.snapshotId ?? options.snapshotId");
        script.Should().NotContain("snapshot?.activeProfile?.name ?? options.profile");
        script.Should().NotContain("snapshot?.subjectPack?.assetId ?? options.subjectPack");
    }

    [Fact]
    public void DeliverRuntime_RequiresSnapshotSubjectPackInsteadOfCliFallback()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/deliver-answer.mjs"));

        script.Should().Contain("loadRequiredResolvedSnapshot(snapshotPath)");
        script.Should().Contain("Resolved snapshot is missing subjectPack.assetId");
        script.Should().NotContain("snapshot.subjectPack?.assetId ?? options.subjectPack");
    }

    [Fact]
    public void DeliveryManifestValidator_ChecksManifestAgainstReferencedSnapshot()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/validate-delivery-manifest.mjs"));

        script.Should().Contain("loadRequiredResolvedSnapshot(snapshotPath)");
        script.Should().Contain("snapshotId must match referenced snapshot.snapshotId.");
        script.Should().Contain("snapshot.version must match referenced snapshot.subjectPack.version.");
        script.Should().Contain("snapshot.profile must match referenced snapshot.activeProfile.name.");
        script.Should().Contain("subjectPack must match referenced snapshot.subjectPack.assetId.");
    }

    [Fact]
    public void SnapshotCompiler_IncludesDeliveryRulesForRuntime()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/rule-compiler/merge-rules.mjs"));

        script.Should().Contain("delivery:");
        script.Should().Contain("rules: assets.config.deliveryRules ?? {}");
    }

    [Fact]
    public void EvalRunner_UsesSubjectManifestAndSnapshotRuntime()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools/latex-renderer/eval-answer-fixtures.mjs"));

        script.Should().Contain("manifest.evaluation?.dataset");
        script.Should().Contain("--snapshot");
        script.Should().Contain("--snapshot-path");
        script.Should().Contain("snapshotTrace");
        script.Should().Contain("expectedSnapshotPath");
        script.Should().Contain("deliverySnapshotPath === compiledSnapshotPath");
        script.Should().NotContain("loadRuntimeConfig(");
        script.Should().NotContain("resolveRuntimeConfigRelativePath");
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
