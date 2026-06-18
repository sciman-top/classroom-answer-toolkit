using System.Diagnostics;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class HeadlessSmokeInstalledAppTests
{
    [Fact]
    public void SmokeScript_Exists_AndTargetsPublishedExe()
    {
        var repoRoot = FindRepoRoot();
        var smokeScript = Path.Combine(repoRoot, "scripts", "smoke-installed-app.ps1");

        File.Exists(smokeScript).Should().BeTrue();

        var content = File.ReadAllText(smokeScript);
        content.Should().Contain("ClassroomToolkit.App.exe");
        content.Should().Contain("--smoke");
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
