using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainWindowXamlContractTests
{
    [Fact]
    public void MainWindowExposesAnswerDeliveryCommands()
    {
        var xaml = File.ReadAllText(Path.Combine(FindRepoRoot(), "src", "ClassroomToolkit.App", "MainWindow.xaml"));

        xaml.Should().Contain("DeliverCommand");
        xaml.Should().Contain("SelectedAnswerMarkdownPath");
        xaml.Should().Contain("LastOutputPdfPath");
        xaml.Should().NotContain("ReviewQueue");
        xaml.Should().NotContain("VisualDecision");
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln"))) return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("Repository root not found.");
    }
}
