using System.Net;
using System.Net.Http;
using System.Text;
using ClassroomToolkit.App.Services;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class ReleaseUpdateServiceTests
{
    [Fact]
    public async Task CheckAsync_AcceptsPowerShellStyleManifestAndFindsNewerApp()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"1.0",
              "version":"1.0.1",
              "releaseUrl":"https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v1.0.1",
              "assets":[
                {
                  "kind":"app",
                  "name":"ClassroomToolkit-1.0.1-win-x64.zip",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-win-x64.zip",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":123
                }
              ]
            }
            """));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeTrue();
        result.UpdateAvailable.Should().BeTrue();
        result.Update.Should().NotBeNull();
        result.Update!.Version.Should().Be("1.0.1");
        result.Update.WorkspaceContract.Should().Be("1");
        result.Update.PackageBytes.Should().Be(123);
    }

    [Fact]
    public async Task CheckAsync_RefusesAppOnlyUpdateWhenWorkspaceContractChanges()
    {
        using var fixture = new InstalledApplicationFixture();
        fixture.WriteInstallReceipt("1");
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "version":"1.0.1",
              "workspaceContract":"2",
              "assets":[
                {
                  "kind":"app",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-win-x64.zip",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":123
                }
              ]
            }
            """));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeTrue();
        result.UpdateAvailable.Should().BeFalse();
        result.Update.Should().BeNull();
        result.Message.Should().Contain("重新部署匹配工作区");
    }

    [Fact]
    public async Task CheckAsync_RejectsInvalidWorkspaceContract()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "version":"1.0.1",
              "workspaceContract":"contract with spaces",
              "assets":[
                {
                  "kind":"app",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-win-x64.zip",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":123
                }
              ]
            }
            """));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeFalse();
        result.UpdateAvailable.Should().BeFalse();
        result.Message.Should().Contain("工作区合同无效");
    }

    [Fact]
    public async Task CheckAsync_RejectsNonGitHubAssetUrl()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"app",
                  "url":"https://example.invalid/update.zip",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":123
                }
              ]
            }
            """));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeFalse();
        result.UpdateAvailable.Should().BeFalse();
        result.Message.Should().Contain("GitHub");
    }

    [Fact]
    public async Task CheckAsync_SkipsSourceWorkspaceWithoutInstalledApplication()
    {
        var repositoryRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-update-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(repositoryRoot, "scripts"));
        File.WriteAllText(Path.Combine(repositoryRoot, "scripts", "update-release.ps1"), "# updater");
        try
        {
            using var service = new ReleaseUpdateService(repositoryRoot, repositoryRoot, currentVersion: new Version(1, 0, 0));

            var result = await service.CheckAsync();

            result.Succeeded.Should().BeTrue();
            result.UpdateAvailable.Should().BeFalse();
            result.Message.Should().Contain("源码");
        }
        finally
        {
            Directory.Delete(repositoryRoot, recursive: true);
        }
    }

    private sealed class InstalledApplicationFixture : IDisposable
    {
        public InstalledApplicationFixture()
        {
            Root = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-update-{Guid.NewGuid():N}");
            RepositoryRoot = Path.Combine(Root, "workspace");
            AppDirectory = Path.Combine(RepositoryRoot, "app");
            Directory.CreateDirectory(Path.Combine(RepositoryRoot, "scripts"));
            Directory.CreateDirectory(AppDirectory);
            File.WriteAllText(Path.Combine(RepositoryRoot, "scripts", "update-release.ps1"), "# updater");
            File.WriteAllText(Path.Combine(AppDirectory, "ClassroomToolkit.App.exe"), "app");
        }

        public string Root { get; }
        public string RepositoryRoot { get; }
        public string AppDirectory { get; }

        public void WriteInstallReceipt(string workspaceContract)
        {
            File.WriteAllText(
                Path.Combine(Root, "install-receipt.json"),
                $$"""{"workspaceContract":"{{workspaceContract}}"}""");
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed class StaticResponseHandler : HttpMessageHandler
    {
        private readonly string _content;

        public StaticResponseHandler(string content)
        {
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_content, Encoding.UTF8, "application/json")
            });
    }
}
