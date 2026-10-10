using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
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
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "channel":"stable",
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
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
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
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
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
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
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
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
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
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
            "not-a-sha256",
            123));

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("SHA-256");
    }

    [Fact]
    public async Task CheckAsync_RejectsUnsupportedManifestSchema()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"1.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"1.0.1",
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
        result.Message.Should().Contain("schema");
    }

    [Fact]
    public async Task InstallAsync_RejectsContentLengthMismatchAndRemovesStagedInstaller()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new BinaryResponseHandler([1, 2, 3, 4]));
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var before = SnapshotStagedInstallers();
        var result = await service.InstallAsync(ValidUpdateInfo(sha256: Sha256Of([1, 2, 3, 4]), bytes: 123));
        var after = SnapshotStagedInstallers();

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("大小不匹配");
        after.Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task InstallAsync_RejectsSha256MismatchAndRemovesStagedInstaller()
    {
        using var fixture = new InstalledApplicationFixture();
        var payload = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        using var client = new HttpClient(new BinaryResponseHandler(payload));
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var before = SnapshotStagedInstallers();
        var result = await service.InstallAsync(ValidUpdateInfo(sha256: new string('b', 64), bytes: payload.Length));
        var after = SnapshotStagedInstallers();

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("SHA-256 不匹配");
        after.Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task InstallAsync_RequiresPublisherThumbprintAndRemovesStagedInstaller()
    {
        using var fixture = new InstalledApplicationFixture();
        var payload = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        using var client = new HttpClient(new BinaryResponseHandler(payload));
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var before = SnapshotStagedInstallers();
        var result = await service.InstallAsync(ValidUpdateInfo(sha256: Sha256Of(payload), bytes: payload.Length));
        var after = SnapshotStagedInstallers();

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("publisherThumbprint");
        after.Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task InstallAsync_RejectsChunkedPayloadAsItExceedsDeclaredSize()
    {
        using var fixture = new InstalledApplicationFixture();
        var payload = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        using var client = new HttpClient(new UnknownLengthResponseHandler(payload));
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var before = SnapshotStagedInstallers();
        var result = await service.InstallAsync(ValidUpdateInfo(sha256: Sha256Of(payload), bytes: 4));
        var after = SnapshotStagedInstallers();

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("超过声明的大小限制");
        after.Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task InstallAsync_RejectsRedirectToUnapprovedHost()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new RedirectResponseHandler());
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var result = await service.InstallAsync(ValidUpdateInfo(new string('a', 64), 8));

        result.Started.Should().BeFalse();
        result.Message.Should().Contain("redirect");
    }

    [Fact]
    public async Task CheckAsync_TreatsUnreadableRuntimeManifestAsFailClosed()
    {
        using var fixture = new InstalledApplicationFixture();
        File.WriteAllText(Path.Combine(fixture.RepositoryRoot, "runtime-manifest.json"), "{ broken");
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            currentVersion: new Version(1, 0, 0));

        var result = await service.CheckAsync();

        // Corruption must surface loudly, never masquerade as "no update".
        result.Succeeded.Should().BeFalse();
        result.UpdateAvailable.Should().BeFalse();
        result.Message.Should().Contain("无法解析");
    }

    [Fact]
    public async Task CheckAsync_ReportsMissingUpdateManifestAsNotPublished()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StatusCodeResponseHandler(HttpStatusCode.NotFound, "{}"));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            httpClient: client,
            currentVersion: new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeFalse();
        result.Message.Should().Contain("尚未发布");
    }

    [Fact]
    public async Task CheckAsync_RejectsPackageAboveTheSizeCap()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler($$"""
            {
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/ClassroomToolkit-1.0.1-setup.exe",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":{{1024L * 1024L * 1024L + 1}}
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
        result.Message.Should().Contain("上限");
    }

    [Fact]
    public async Task CheckAsync_RejectsNonHttpsAssetUrl()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "url":"http://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/setup.exe",
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
        result.Message.Should().Contain("HTTPS");
    }

    [Fact]
    public async Task CheckAsync_RejectsInvalidManifestVersion()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"not-a-version",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/setup.exe",
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
        result.Message.Should().Contain("版本号无效");
    }

    [Fact]
    public async Task CheckAsync_ReportsAlreadyLatestWithoutUpdate()
    {
        using var fixture = new InstalledApplicationFixture();
        using var client = new HttpClient(new StaticResponseHandler("""
            {
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/setup.exe",
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
            new Version(1, 0, 1));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeTrue();
        result.UpdateAvailable.Should().BeFalse();
        result.Update.Should().BeNull();
        result.Message.Should().Contain("最新版本");
    }

    [Fact]
    public async Task InstallAsync_RejectsTruncatedDownload()
    {
        using var fixture = new InstalledApplicationFixture();
        var payload = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        using var client = new HttpClient(new TruncatedResponseHandler(payload, declaredBytes: payload.Length));
        using var service = new ReleaseUpdateService(fixture.RepositoryRoot, fixture.AppDirectory, httpClient: client);

        var before = SnapshotStagedInstallers();
        var result = await service.InstallAsync(ValidUpdateInfo(sha256: Sha256Of(payload), bytes: payload.Length));
        var after = SnapshotStagedInstallers();

        // The declared length satisfied the header check; the short body must
        // still fail the bounded copy instead of hashing half an installer.
        result.Started.Should().BeFalse();
        result.Message.Should().Contain("大小不匹配");
        after.Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task CheckAsync_FollowsRedirectToApprovedHostAndFindsUpdate()
    {
        using var fixture = new InstalledApplicationFixture();
        const string manifest = """
            {
              "schemaVersion":"2.0",
              "kind":"classroom-toolkit-update-manifest",
              "version":"1.0.1",
              "assets":[
                {
                  "kind":"installer",
                  "url":"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.1/setup.exe",
                  "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "bytes":123
                }
              ]
            }
            """;
        using var client = new HttpClient(new RedirectChainHandler(
            ("https://objects.githubusercontent.com/classroom-toolkit/update-manifest.json", manifest)));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json",
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeTrue();
        result.UpdateAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task CheckAsync_FailsRedirectLoopsAfterFiveHops()
    {
        using var fixture = new InstalledApplicationFixture();
        var loopTarget = "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json";
        using var client = new HttpClient(new SelfRedirectHandler(loopTarget));
        using var service = new ReleaseUpdateService(
            fixture.RepositoryRoot,
            fixture.AppDirectory,
            loopTarget,
            client,
            new Version(1, 0, 0));

        var result = await service.CheckAsync();

        result.Succeeded.Should().BeFalse();
        result.Message.Should().Contain("redirect");
    }

    // No unit test drives WindowsAuthenticodeTrust.IsTrusted: WinVerifyTrust
    // access-violates natively on malformed unsigned input, and a meaningful
    // trust check needs a real signed binary (covered by the packaging
    // pipeline's Sign-And-Verify instead).

    private static UpdateInfo ValidUpdateInfo(string sha256, long bytes) => new(
        "9.9.9",
        "1",
        "https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v9.9.9/ClassroomToolkit-9.9.9-setup.exe",
        sha256,
        bytes);

    private static string[] SnapshotStagedInstallers() =>
        Directory.GetFiles(Path.GetTempPath(), "ClassroomToolkit-9.9.9-*-setup.exe");

    private static string Sha256Of(byte[] payload) =>
        Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();

    [Fact]
    public async Task CheckAsync_SkipsSourceWorkspaceWithoutInstalledApplication()
    {
        var repositoryRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-update-{Guid.NewGuid():N}");
        Directory.CreateDirectory(repositoryRoot);
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
    public async Task CheckAsync_SkipsSourceBuildEvenWhenItContainsAnApphost()
    {
        var repositoryRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-update-{Guid.NewGuid():N}");
        var debugApplicationDirectory = Path.Combine(repositoryRoot, "src", "ClassroomToolkit.App", "bin", "Debug", "net10.0-windows");
        Directory.CreateDirectory(debugApplicationDirectory);
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

    private sealed class BinaryResponseHandler : HttpMessageHandler
    {
        private readonly byte[] _content;

        public BinaryResponseHandler(byte[] content)
        {
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(_content)
            });
    }

    private sealed class UnknownLengthResponseHandler : HttpMessageHandler
    {
        private readonly byte[] _content;

        public UnknownLengthResponseHandler(byte[] content)
        {
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new UnknownLengthContent(_content)
            });
    }

    private sealed class RedirectResponseHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
            {
                Headers = { Location = new Uri("https://example.invalid/installer.exe") }
            });
    }

    private sealed class SelfRedirectHandler : HttpMessageHandler
    {
        private readonly string _location;

        public SelfRedirectHandler(string location)
        {
            _location = location;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
            {
                Headers = { Location = new Uri(_location) }
            });
    }

    private sealed class RedirectChainHandler : HttpMessageHandler
    {
        private readonly (string Location, string Content)[] _hops;
        private int _hopIndex;

        public RedirectChainHandler(params (string Location, string Content)[] hops)
        {
            _hops = hops;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (_hopIndex < _hops.Length)
            {
                var (location, _) = _hops[_hopIndex];
                _hopIndex += 1;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
                {
                    Headers = { Location = new Uri(location) }
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_hops[^1].Content, Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class StatusCodeResponseHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _statusCode;
        private readonly string _content;

        public StatusCodeResponseHandler(HttpStatusCode statusCode, string content)
        {
            _statusCode = statusCode;
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(_statusCode)
            {
                Content = new StringContent(_content, Encoding.UTF8, "application/json")
            });
    }

    private sealed class TruncatedResponseHandler : HttpMessageHandler
    {
        private readonly byte[] _content;
        private readonly long _declaredBytes;

        public TruncatedResponseHandler(byte[] content, long declaredBytes)
        {
            _content = content;
            _declaredBytes = declaredBytes;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(_content[..(_content.Length / 2)])
            };
            // Override the automatic length with the declaration the server
            // promised so only the bounded-copy guard can catch the shortfall.
            response.Content.Headers.ContentLength = _declaredBytes;
            return Task.FromResult(response);
        }
    }

    private sealed class UnknownLengthContent : HttpContent
    {
        private readonly byte[] _content;

        public UnknownLengthContent(byte[] content)
        {
            _content = content;
        }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(_content).AsTask();

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
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
