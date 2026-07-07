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

    [Fact]
    public void SmokeScript_ValidatesSubjectPackAndSnapshotDiagnostics()
    {
        var repoRoot = FindRepoRoot();
        var smokeScript = Path.Combine(repoRoot, "scripts", "smoke-installed-app.ps1");

        var content = File.ReadAllText(smokeScript);
        content.Should().Contain("primarySubjectPack");
        content.Should().Contain("subjectPacks");
        content.Should().Contain("snapshotPath");
        content.Should().Contain("ConvertFrom-Json");
        content.Should().Contain("Diagnostics manifest missing primarySubjectPack.");
        content.Should().Contain("published-app-smoke-report");
        content.Should().Contain("subjectPackIndexPath");
        content.Should().Contain("Resolve-BundleRelativePath");
        content.Should().Contain("Diagnostics bundle missing primary subject-pack manifest:");
        content.Should().Contain("Diagnostics bundle missing primary subject-pack humanSpec:");
        content.Should().Contain("Diagnostics bundle missing primary subject-pack mirroredSpec:");
        content.Should().Contain("Diagnostics bundle missing primary subject-pack acceptanceChecklist:");
        content.Should().Contain("Smoke stdout subjectPacks does not match diagnostics manifest.");
        content.Should().Contain("Smoke report:");
    }

    [Fact]
    public void PublishScript_WritesSmokeReportPath()
    {
        var repoRoot = FindRepoRoot();
        var publishScript = Path.Combine(repoRoot, "scripts", "publish-app.ps1");

        var content = File.ReadAllText(publishScript);
        content.Should().Contain("dotnet restore src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -r $runtimeIdentifier");
        content.Should().Contain("throw \"dotnet restore failed for publish runtime.\"");
        content.Should().Contain("smoke-report.json");
        content.Should().Contain("-ReportPath $smokeReportPath");
        content.Should().Contain("Publish smoke report:");
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
