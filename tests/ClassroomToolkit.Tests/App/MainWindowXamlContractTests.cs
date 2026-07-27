using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainWindowXamlContractTests
{
    [Fact]
    public void ReviewQueue_DisplaysSourcePath_AndRawByteSha256()
    {
        var repositoryRoot = FindRepoRoot();
        var xaml = File.ReadAllText(Path.Combine(
            repositoryRoot,
            "src",
            "ClassroomToolkit.App",
            "MainWindow.xaml"));

        xaml.Should().Contain("DisplayMemberBinding=\"{Binding SourcePath}\"");
        xaml.Should().Contain("DisplayMemberBinding=\"{Binding SourceSha256}\"");
        xaml.Should().Contain("Header=\"Raw-byte SHA-256\"");
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
        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}
