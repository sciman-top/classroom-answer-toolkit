using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MsixPackagingScriptTests
{
    [Fact]
    public void PackMsixScript_DefinesManifestAndMakeAppxFallback()
    {
        var repoRoot = FindRepoRoot();
        var scriptPath = Path.Combine(repoRoot, "scripts", "pack-msix.ps1");

        File.Exists(scriptPath).Should().BeTrue();

        var script = File.ReadAllText(scriptPath);
        script.Should().Contain("AppxManifest.xml");
        script.Should().Contain("Windows.FullTrustApplication");
        script.Should().Contain("makeappx.exe");
        script.Should().Contain("MSIX staging prepared without packaging");
    }

    [Fact]
    public void DeliverScript_ExposesExplicitSnapshotPath()
    {
        var repoRoot = FindRepoRoot();
        var scriptPath = Path.Combine(repoRoot, "tools", "latex-renderer", "deliver-answer.mjs");

        File.Exists(scriptPath).Should().BeTrue();

        var script = File.ReadAllText(scriptPath);
        script.Should().Contain("--snapshot-path");
        script.Should().Contain("reuse snapshot");
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
