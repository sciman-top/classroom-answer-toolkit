using System.Net;
using System.Net.Http;
using System.Text;
using ClassroomToolkit.App.Services;
using FluentAssertions;

namespace ClassroomToolkit.Tests.App;

public sealed class ReleaseUpdateServiceTests
{
    [Fact]
    public async Task CheckAsync_AcceptsInstallerManifestAndFindsNewerSetup()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"1.0",
              "version":"1.0.1",
              "releaseUrl":"https://github.com/sciman-top/classroom-answer-toolkit/releases/tag/v1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "name":"ClassroomToolkit-1.0.1-setup.exe",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
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
        fixture.WriteRuntimeManifest("1");
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "version":"1.0.1",
              "workspaceContract":"2",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
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
        result.Message.Should().Contain("新版安装程序");
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
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
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
                  "kind":"installer",
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

    [Theory]
    [InlineData("not-a-sha256", 123L, "SHA-256")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0L, "大小")]
    public async Task CheckAsync_RejectsInvalidPackageIntegrityMetadata(string sha256, long bytes, string expectedMessage)
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler($$"""
            {
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
                  "sha256":"{{sha256}}",
                  "bytes":{{bytes}}
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
        result.Update.Should().BeNull();
        result.Message.Should().Contain(expectedMessage);
    }

    [Fact]
    public async Task InstallAsync_RefusesInvalidPackageMetadataBeforeStartingTheUpdater()
    {
        using var fixture = new InstalledApplicationFixture();
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory);

        var result = await service.InstallAsync(new UpdateInfo(
            "1.0.1",
            "1",
            string.Empty,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
            "not-a-sha256",
            123,
            string.Empty));

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("SHA-256");
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

    [Fact]
    public async Task CheckAsync_SkipsSourceBuildEvenWhenItContainsAnApphostAndUpdater()
    {
        var repositoryRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-update-{Guid.NewGuid():N}");
        var debugApplicationDirectory = Path.Combine(repositoryRoot, "src", "ClassroomToolkit.App", "bin", "Debug", "net10.0-windows");
        Directory.CreateDirectory(Path.Combine(repositoryRoot, "scripts"));
        Directory.CreateDirectory(debugApplicationDirectory);
        File.WriteAllText(Path.Combine(repositoryRoot, "scripts", "update-release.ps1"), "# updater");
        File.WriteAllText(Path.Combine(debugApplicationDirectory, "ClassroomToolkit.App.exe"), "debug apphost");
        try
        {
            using var client = new HttpClient(new StaticResponseHandler("{}"));
            using var service = new ReleaseUpdateService(
                repositoryRoot,
                debugApplicationDirectory,
                httpClient: client,
                currentVersion: new Version(1, 0, 0));

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
            RepositoryRoot = Root;
            AppDirectory = Root;
            Directory.CreateDirectory(Path.Combine(RepositoryRoot, "tools"));
            Directory.CreateDirectory(Path.Combine(RepositoryRoot, "prompts"));
            Directory.CreateDirectory(Path.Combine(RepositoryRoot, "runtime", "node"));
            File.WriteAllText(Path.Combine(RepositoryRoot, "runtime-manifest.json"), "{\"workspaceContract\":\"1\",\"distributionMode\":\"installer\"}");
            File.WriteAllText(Path.Combine(RepositoryRoot, "runtime", "node", "node.exe"), "node");
            Directory.CreateDirectory(AppDirectory);
            File.WriteAllText(Path.Combine(AppDirectory, "ClassroomToolkit.App.exe"), "app");
        }

        public string Root { get; }
        public string RepositoryRoot { get; }
        public string AppDirectory { get; }

        public void WriteRuntimeManifest(string workspaceContract)
        {
            File.WriteAllText(
                Path.Combine(Root, "runtime-manifest.json"),
                $$"""{"workspaceContract":"{{workspaceContract}}","distributionMode":"installer"}""");
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
