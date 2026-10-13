using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ClassroomToolkit.App.Services;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

[Trait("Gate", "ToolchainIntegration")]
public sealed class InstallReleaseScriptTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ManualInstallDownloadsAndVerifiesInstaller(bool chunked)
    {
        var payload = Encoding.UTF8.GetBytes("loopback installer fixture");
        await using var server = new LoopbackServer(payload, chunked);
        var manifest = JsonSerializer.Serialize(new
        {
            schemaVersion = "2.0", kind = "classroom-toolkit-update-manifest", version = "1.0.0",
            publisherThumbprint = "simulation", assets = new[] { new
            {
                kind = "installer", name = "fixture-setup.exe", url = server.Url + "setup.exe",
                bytes = payload.Length, sha256 = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant()
            } }
        });
        server.Manifest = manifest;
        var root = ToolchainTestHost.FindRepoRoot();
        var result = await new PowerShellProcessRunner().RunAsync("pwsh",
            ["-NoProfile", "-File", "scripts/install-release.ps1", "-ManifestUrl", server.Url + "manifest.json", "-AllowLocalSimulation"],
            root, timeout: TimeSpan.FromSeconds(15));
        var installerPath = result.StandardOutput.Split('\n')
            .FirstOrDefault(line => line.StartsWith("Verified ClassroomToolkit"))?.Split("installer: ")[^1].Trim();
        try
        {
            result.ExitCode.Should().Be(0, result.StandardError);
            installerPath.Should().NotBeNull();
            File.ReadAllBytes(installerPath!).Should().Equal(payload);
        }
        finally
        {
            if (installerPath is not null)
            {
                // The script created this unique workspace for this fixture.
                var workspace = Directory.GetParent(Path.GetDirectoryName(installerPath)!)!.FullName;
                Directory.Delete(workspace, true);
            }
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StalledDownloadHasDeadlineAndOnlyRemovesItsOwnPartialFile(bool existingTarget)
    {
        await using var server = new LoopbackServer([], false) { Stall = true };
        var root = ToolchainTestHost.FindRepoRoot();
        var target = Path.Combine(Path.GetTempPath(), $"install-timeout-{Guid.NewGuid():N}.exe");
        if (existingTarget) { File.WriteAllText(target, "preserved existing file"); }
        var source = Path.Combine(root, "scripts", "install-release.ps1").Replace("'", "''");
        var script = $$"""
            $ErrorActionPreference = 'Stop'
            Set-StrictMode -Version Latest
            $script:MaximumDownloadBytes = 1GB
            $ast = [Management.Automation.Language.Parser]::ParseFile('{{source}}', [ref]$null, [ref]$null)
            foreach ($name in @('Assert-ApprovedGitHubUri', 'Invoke-ApprovedDownload')) {
                $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
                . ([scriptblock]::Create($function.Extent.Text))
            }
            Invoke-ApprovedDownload -UriValue '{{server.Url}}setup.exe' -TargetPath '{{target.Replace("'", "''")}}' -ExactBytes 8 -TimeoutSeconds 1 -AllowLocalSimulation
            """;
        try
        {
            var result = await new PowerShellProcessRunner().RunAsync("pwsh", ["-NoProfile", "-Command", script], root,
                timeout: TimeSpan.FromSeconds(10));
            result.ExitCode.Should().NotBe(0);
            result.StandardError.Should().NotContain("cannot be found");
            if (existingTarget) { File.ReadAllText(target).Should().Be("preserved existing file"); }
            else { File.Exists(target).Should().BeFalse(); }
        }
        finally { File.Delete(target); }
    }

    private sealed class LoopbackServer : IAsyncDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _cancellation = new();
        private readonly Task _serve;
        private readonly byte[] _payload;
        private readonly bool _chunked;
        public string Manifest { get; set; } = "{}";
        public bool Stall { get; init; }
        public string Url { get; }

        public LoopbackServer(byte[] payload, bool chunked)
        {
            _payload = payload;
            _chunked = chunked;
            _listener.Start();
            Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/";
            _serve = ServeAsync();
        }

        private async Task ServeAsync()
        {
            try
            {
                while (!_cancellation.IsCancellationRequested)
                {
                    using var client = await _listener.AcceptTcpClientAsync(_cancellation.Token);
                    await using var stream = client.GetStream();
                    using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
                    var request = await reader.ReadLineAsync(_cancellation.Token) ?? "";
                    while (await reader.ReadLineAsync(_cancellation.Token) is { Length: > 0 }) { }
                    var bytes = request.Contains("manifest.json") ? Encoding.UTF8.GetBytes(Manifest) : _payload;
                    var framing = _chunked ? "Transfer-Encoding: chunked" : $"Content-Length: {(Stall ? 8 : bytes.Length)}";
                    await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\n{framing}\r\nConnection: close\r\n\r\n"), _cancellation.Token);
                    if (Stall) { await Task.Delay(Timeout.InfiniteTimeSpan, _cancellation.Token); }
                    if (_chunked) { await stream.WriteAsync(Encoding.ASCII.GetBytes($"{bytes.Length:x}\r\n"), _cancellation.Token); }
                    await stream.WriteAsync(bytes, _cancellation.Token);
                    if (_chunked) { await stream.WriteAsync(Encoding.ASCII.GetBytes("\r\n0\r\n\r\n"), _cancellation.Token); }
                }
            }
            catch (OperationCanceledException) when (_cancellation.IsCancellationRequested) { }
        }

        public async ValueTask DisposeAsync()
        {
            await _cancellation.CancelAsync();
            await _serve;
            _listener.Stop();
            _cancellation.Dispose();
        }
    }
}
