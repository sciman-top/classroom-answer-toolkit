using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace ClassroomToolkit.App.Services;

public interface IUpdateService
{
    Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken = default);

    Task<UpdateInstallResult> InstallAsync(
        UpdateInfo update,
        CancellationToken cancellationToken = default);
}

public sealed record UpdateInfo(
    string Version,
    string WorkspaceContract,
    string ReleaseUrl,
    string PackageUrl,
    string PackageSha256,
    long PackageBytes,
    string ReleaseNotes);

public sealed record UpdateCheckResult(
    bool Succeeded,
    bool UpdateAvailable,
    UpdateInfo? Update,
    string Message)
{
    public static UpdateCheckResult NoUpdate(string message) => new(true, false, null, message);

    public static UpdateCheckResult Available(UpdateInfo update) => new(true, true, update, $"发现新版本 {update.Version}");

    public static UpdateCheckResult Unavailable(string message) => new(false, false, null, message);
}

public sealed record UpdateInstallResult(
    bool Started,
    string Message);

public sealed class ReleaseUpdateService : IUpdateService, IDisposable
{
    public const string DefaultManifestUrl =
        "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json";

    private static readonly Version DevelopmentVersion = new(0, 0, 0);
    private const string LegacyWorkspaceContract = "1";
    private readonly HttpClient _httpClient;
    private readonly string _repositoryRoot;
    private readonly string _manifestUrl;
    private readonly string _applicationDirectory;
    private readonly bool _ownsHttpClient;
    private readonly Version? _currentVersion;

    public ReleaseUpdateService(
        string repositoryRoot,
        string? applicationDirectory = null,
        string? manifestUrl = null,
        HttpClient? httpClient = null,
        Version? currentVersion = null)
    {
        _repositoryRoot = Path.GetFullPath(repositoryRoot);
        _applicationDirectory = Path.GetFullPath(applicationDirectory ?? AppContext.BaseDirectory);
        _manifestUrl = manifestUrl ?? DefaultManifestUrl;
        _httpClient = httpClient ?? CreateHttpClient();
        _ownsHttpClient = httpClient is null;
        _currentVersion = currentVersion;
    }

    public async Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        if (!CanUpdateInstalledApplication())
        {
            return UpdateCheckResult.NoUpdate("当前是源码/调试运行，跳过安装版更新检查");
        }

        try
        {
            using var response = await _httpClient.GetAsync(_manifestUrl, cancellationToken).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return UpdateCheckResult.Unavailable("GitHub Release 尚未发布更新清单");
            }

            response.EnsureSuccessStatusCode();
            await using var content = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            var manifest = await JsonSerializer.DeserializeAsync<ReleaseUpdateManifest>(
                content,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
                cancellationToken).ConfigureAwait(false);
            if (manifest is null)
            {
                return UpdateCheckResult.Unavailable("更新清单为空");
            }

            var currentVersion = _currentVersion ?? GetCurrentVersion();
            if (!Version.TryParse(manifest.Version, out var latestVersion))
            {
                return UpdateCheckResult.Unavailable("更新清单的版本号无效");
            }

            if (latestVersion <= currentVersion)
            {
                return UpdateCheckResult.NoUpdate($"当前已是最新版本 {FormatVersion(currentVersion)}");
            }

            var targetWorkspaceContract = ParseWorkspaceContract(manifest.WorkspaceContract);
            if (targetWorkspaceContract is null)
            {
                return UpdateCheckResult.Unavailable("更新清单的工作区合同无效");
            }

            var installedWorkspaceContract = GetInstalledWorkspaceContract();
            if (!string.Equals(targetWorkspaceContract, installedWorkspaceContract, StringComparison.Ordinal))
            {
                return UpdateCheckResult.NoUpdate(
                    $"新版本需要工作区合同 {targetWorkspaceContract}，当前安装为 {installedWorkspaceContract}；请使用预览安装器重新部署匹配工作区");
            }

            var asset = manifest.Assets?.FirstOrDefault(item => string.Equals(item.Kind, "app", StringComparison.OrdinalIgnoreCase));
            if (asset is null || string.IsNullOrWhiteSpace(asset.Url) || string.IsNullOrWhiteSpace(asset.Sha256))
            {
                return UpdateCheckResult.Unavailable("更新清单缺少 app 下载资产或 SHA-256");
            }

            if (!Uri.TryCreate(asset.Url, UriKind.Absolute, out var assetUri)
                || assetUri.Scheme != Uri.UriSchemeHttps
                || !IsAllowedDownloadHost(assetUri.Host))
            {
                return UpdateCheckResult.Unavailable("更新资产 URL 不是允许的 HTTPS GitHub 地址");
            }

            return UpdateCheckResult.Available(new UpdateInfo(
                manifest.Version!,
                targetWorkspaceContract,
                manifest.ReleaseUrl ?? string.Empty,
                asset.Url!,
                asset.Sha256.ToLowerInvariant(),
                asset.Bytes,
                manifest.ReleaseNotes ?? string.Empty));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or JsonException or InvalidOperationException)
        {
            return UpdateCheckResult.Unavailable($"更新检查失败：{ex.Message}");
        }
    }

    public Task<UpdateInstallResult> InstallAsync(
        UpdateInfo update,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanUpdateInstalledApplication())
        {
            return Task.FromResult(new UpdateInstallResult(false, "当前不是可更新的安装版目录"));
        }

        var updaterScript = Path.Combine(_repositoryRoot, "scripts", "update-release.ps1");
        if (!File.Exists(updaterScript))
        {
            return Task.FromResult(new UpdateInstallResult(false, $"更新脚本不存在：{updaterScript}"));
        }

        var executablePath = Path.Combine(_applicationDirectory, "ClassroomToolkit.App.exe");
        var startInfo = new ProcessStartInfo
        {
            FileName = "pwsh",
            WorkingDirectory = _repositoryRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        foreach (var argument in new[]
        {
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", updaterScript,
            "-PackageUrl", update.PackageUrl,
            "-ExpectedSha256", update.PackageSha256,
            "-ExpectedBytes", update.PackageBytes.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-TargetAppDirectory", _applicationDirectory,
            "-RepositoryRoot", _repositoryRoot,
            "-ProcessId", Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-RestartExecutable", executablePath
        })
        {
            startInfo.ArgumentList.Add(argument);
        }

        try
        {
            Process.Start(startInfo)?.Dispose();
            return Task.FromResult(new UpdateInstallResult(true, $"已安排 {update.Version} 更新，应用即将重启"));
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return Task.FromResult(new UpdateInstallResult(false, $"无法启动更新器：{ex.Message}"));
        }
    }

    public void Dispose()
    {
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }

    private bool CanUpdateInstalledApplication()
    {
        return File.Exists(Path.Combine(_applicationDirectory, "ClassroomToolkit.App.exe"))
            && File.Exists(Path.Combine(_repositoryRoot, "scripts", "update-release.ps1"));
    }

    private static Version GetCurrentVersion()
    {
        var versionText = Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrWhiteSpace(versionText))
        {
            return Assembly.GetEntryAssembly()?.GetName().Version ?? DevelopmentVersion;
        }

        var separator = versionText.IndexOf('+', StringComparison.Ordinal);
        if (separator >= 0)
        {
            versionText = versionText[..separator];
        }

        return Version.TryParse(versionText, out var version) ? version : DevelopmentVersion;
    }

    private static string FormatVersion(Version version) => $"{version.Major}.{version.Minor}.{version.Build}";

    private string GetInstalledWorkspaceContract()
    {
        var installRoot = Directory.GetParent(_repositoryRoot)?.FullName;
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            return LegacyWorkspaceContract;
        }

        var receiptPath = Path.Combine(installRoot, "install-receipt.json");
        if (!File.Exists(receiptPath))
        {
            return LegacyWorkspaceContract;
        }

        try
        {
            using var receiptStream = File.OpenRead(receiptPath);
            var receipt = JsonSerializer.Deserialize<InstallReceipt>(receiptStream,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return ParseWorkspaceContract(receipt?.WorkspaceContract) ?? LegacyWorkspaceContract;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return LegacyWorkspaceContract;
        }
    }

    private static string? ParseWorkspaceContract(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? LegacyWorkspaceContract
            : System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
                ? value
                : null;

    private static bool IsAllowedDownloadHost(string host) =>
        host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
        || host.Equals("objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase)
        || host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ClassroomToolkit-UpdateClient/1.0");
        return client;
    }

    private sealed class ReleaseUpdateManifest
    {
        public string? Version { get; set; }
        public string? WorkspaceContract { get; set; }
        public string? ReleaseUrl { get; set; }
        public string? ReleaseNotes { get; set; }
        public List<ReleaseAsset>? Assets { get; set; }
    }

    private sealed class ReleaseAsset
    {
        public string? Kind { get; set; }
        public string? Url { get; set; }
        public string? Sha256 { get; set; }
        public long Bytes { get; set; }
    }

    private sealed class InstallReceipt
    {
        public string? WorkspaceContract { get; set; }
    }
}
