using System.Text.RegularExpressions;
using ClassroomToolkit.App.Workspace;
using FluentAssertions;
using Xunit;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class DownloadHostContractTests
{
    // The installed app (UpdateService) and the manual path (install-release.ps1)
    // each carry their own download host whitelist; the C# side once drifted to a
    // broad suffix match and the divergence was only caught by review. The two
    // lists are the same security boundary and must move together.
    [Fact]
    public void UpdateService_and_install_release_declare_the_same_download_hosts()
    {
        var repositoryRoot = new RepositoryRootResolver().ResolveRepositoryRoot();
        var updateServiceSource = File.ReadAllText(
            Path.Combine(repositoryRoot, "src", "ClassroomToolkit.App", "Services", "UpdateService.cs"));
        var installReleaseSource = File.ReadAllText(
            Path.Combine(repositoryRoot, "scripts", "install-release.ps1"));

        var updateServiceHosts = Regex.Matches(
                updateServiceSource,
                @"host\.Equals\(""(?<host>[^""]+)""\, StringComparison")
            .Select(match => match.Groups["host"].Value.ToLowerInvariant())
            .ToHashSet();
        var installReleaseBody = Regex.Match(
                installReleaseSource,
                @"\$allowedHosts\s*=\s*@\((?<body>.*?)\)",
                RegexOptions.Singleline)
            .Groups["body"].Value;
        var installReleaseHosts = Regex.Matches(installReleaseBody, @"""(?<host>[^""]+)""")
            .Select(match => match.Groups["host"].Value.ToLowerInvariant())
            .ToHashSet();

        updateServiceHosts.Should().NotBeEmpty("the UpdateService whitelist must be found");
        installReleaseHosts.Should().NotBeEmpty("the install-release whitelist must be found");
        updateServiceHosts.Should().BeEquivalentTo(installReleaseHosts);
    }
}
