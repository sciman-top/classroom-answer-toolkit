using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class MainWindowXamlContractTests
{
    [Fact]
    public void ProviderGeneration_ExposesExplicitEgressAndStableAutomationIds()
    {
        var xaml = ReadMainWindowXaml();

        xaml.Should().Contain("AutomationProperties.AutomationId=\"GenerationRequestPath\"");
        xaml.Should().Contain("AutomationProperties.AutomationId=\"GenerationWorkspaceRoot\"");
        xaml.Should().Contain("AutomationProperties.AutomationId=\"GenerationOutputDirectoryPath\"");
        xaml.Should().Contain("AutomationProperties.AutomationId=\"GenerationConfigEnvFilePath\"");
        xaml.Should().Contain("AutomationProperties.AutomationId=\"AllowGenerationCloudEgress\"");
        xaml.Should().Contain("AutomationProperties.AutomationId=\"GenerateProviderAnswer\"");
        xaml.Should().Contain("Command=\"{Binding GenerateProviderAnswerCommand}\"");
        xaml.Should().Contain("Content=\"允许公开题目云外发\"");
    }

    [Fact]
    public void ReviewQueue_DisplaysSourcePath_AndRawByteSha256()
    {
        var xaml = ReadMainWindowXaml();

        xaml.Should().Contain("DisplayMemberBinding=\"{Binding SourcePath}\"");
        xaml.Should().Contain("DisplayMemberBinding=\"{Binding SourceSha256}\"");
        xaml.Should().Contain("Header=\"Raw-byte SHA-256\"");
    }

    private static string ReadMainWindowXaml()
    {
        return File.ReadAllText(Path.Combine(
            FindRepoRoot(),
            "src",
            "ClassroomToolkit.App",
            "MainWindow.xaml"));
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
