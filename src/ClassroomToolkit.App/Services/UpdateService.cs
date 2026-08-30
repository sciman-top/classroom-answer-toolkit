using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
                    $"新版本需要工作区合同 {targetWorkspaceContract}，当前安装为 {installedWorkspaceContract}；请运行新版安装程序完成升级");
            }

            var asset = manifest.Assets?.FirstOrDefault(item => string.Equals(item.Kind, "installer", StringComparison.OrdinalIgnoreCase));
            if (asset is null)
            {
                return UpdateCheckResult.Unavailable("更新清单缺少 installer 下载资产");
            }

            var packageValidationError = ValidateUpdatePackage(asset.Url, asset.Sha256, asset.Bytes);
            if (packageValidationError is not null)
            {
                return UpdateCheckResult.Unavailable(packageValidationError);
            }

            return UpdateCheckResult.Available(new UpdateInfo(
                manifest.Version!,
                targetWorkspaceContract,
                manifest.ReleaseUrl ?? string.Empty,
                asset.Url!,
                asset.Sha256!.ToLowerInvariant(),
                asset.Bytes,
                manifest.ReleaseNotes ?? string.Empty));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or JsonException or InvalidOperationException or OperationCanceledException)
        {
            // HttpClient's own 30s timeout surfaces as TaskCanceledException with
            // the caller's token untouched, so the first filter does not take it;
            // it must degrade to the Chinese status, not escape as a raw message.
            return UpdateCheckResult.Unavailable($"更新检查失败：{ex.Message}");
        }
    }

    public async Task<UpdateInstallResult> InstallAsync(
        UpdateInfo update,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanUpdateInstalledApplication())
        {
            return new UpdateInstallResult(false, "当前不是可更新的安装版目录");
        }

        var packageValidationError = ValidateUpdatePackage(
            update.PackageUrl,
            update.PackageSha256,
            update.PackageBytes);
        if (packageValidationError is not null)
        {
            return new UpdateInstallResult(false, packageValidationError);
        }

        var setupPath = Path.Combine(
            Path.GetTempPath(),
            $"ClassroomToolkit-{update.Version}-{Guid.NewGuid():N}-setup.exe");
        try
        {
            using var response = await _httpClient.GetAsync(
                update.PackageUrl,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
            await using (var destination = new FileStream(
                setupPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                1024 * 128,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await source.CopyToAsync(destination, cancellationToken).ConfigureAwait(false);
            }

            var setupInfo = new FileInfo(setupPath);
            if (setupInfo.Length != update.PackageBytes)
            {
                throw new InvalidDataException($"更新安装程序大小不匹配：expected {update.PackageBytes}, actual {setupInfo.Length}");
            }

            await using (var setupStream = File.OpenRead(setupPath))
            {
                var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(setupStream, cancellationToken))
                    .ToLowerInvariant();
                if (!string.Equals(actualHash, update.PackageSha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("更新安装程序 SHA-256 不匹配");
                }
            }

            var runtimeManifest = ReadRuntimeManifest();
            if (string.IsNullOrWhiteSpace(runtimeManifest?.PublisherThumbprint))
            {
                throw new InvalidDataException("安装版运行时缺少 publisherThumbprint，无法验证更新发布者");
            }
            if (!WindowsAuthenticodeTrust.IsTrusted(setupPath))
            {
                throw new InvalidDataException("更新安装程序未通过 Windows Authenticode 信任验证");
            }
            var signer = X509CertificateLoader.LoadCertificateFromFile(setupPath);
            if (!string.Equals(
                signer.Thumbprint,
                runtimeManifest.PublisherThumbprint,
                StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("更新安装程序发布者与当前安装版不一致");
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = setupPath,
                WorkingDirectory = Path.GetDirectoryName(setupPath)!,
                UseShellExecute = true
            };
            foreach (var argument in new[]
            {
                "/SP-",
                "/SILENT",
                "/SUPPRESSMSGBOXES",
                "/NORESTART",
                "/CLOSEAPPLICATIONS",
                "/RESTARTAPPLICATIONS"
            })
            {
                startInfo.ArgumentList.Add(argument);
            }

            Process.Start(startInfo)?.Dispose();
            return new UpdateInstallResult(true, $"已启动 {update.Version} 安装程序，应用即将重启");
        }
        catch (Exception ex) when (ex is HttpRequestException
            or IOException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception)
        {
            try
            {
                if (File.Exists(setupPath))
                {
                    File.Delete(setupPath);
                }
            }
            catch (IOException)
            {
            }

            return new UpdateInstallResult(false, $"无法启动更新安装程序：{ex.Message}");
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
        if (!string.Equals(
            _applicationDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            _repositoryRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var runtimeManifest = ReadRuntimeManifest();
        return string.Equals(runtimeManifest?.DistributionMode, "installer", StringComparison.OrdinalIgnoreCase)
            && File.Exists(Path.Combine(_applicationDirectory, "ClassroomToolkit.App.exe"));
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
        return ParseWorkspaceContract(ReadRuntimeManifest()?.WorkspaceContract) ?? LegacyWorkspaceContract;
    }

    private RuntimeManifest? ReadRuntimeManifest()
    {
        var manifestPath = Path.Combine(_repositoryRoot, "runtime-manifest.json");
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        try
        {
            using var stream = File.OpenRead(manifestPath);
            return JsonSerializer.Deserialize<RuntimeManifest>(stream,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
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

    private static string? ValidateUpdatePackage(string? packageUrl, string? sha256, long bytes)
    {
        if (string.IsNullOrWhiteSpace(packageUrl) || string.IsNullOrWhiteSpace(sha256))
        {
            return "更新清单缺少 installer 下载资产或 SHA-256";
        }

        if (!Uri.TryCreate(packageUrl, UriKind.Absolute, out var packageUri)
            || packageUri.Scheme != Uri.UriSchemeHttps
            || !IsAllowedDownloadHost(packageUri.Host))
        {
            return "更新资产 URL 不是允许的 HTTPS GitHub 地址";
        }

        if (!System.Text.RegularExpressions.Regex.IsMatch(sha256, "^[A-Fa-f0-9]{64}$"))
        {
            return "更新资产 SHA-256 格式无效";
        }

        return bytes > 0 ? null : "更新资产大小必须为正数";
    }

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

    private sealed class RuntimeManifest
    {
        public string? WorkspaceContract { get; set; }
        public string? DistributionMode { get; set; }
        public string? PublisherThumbprint { get; set; }
    }

    private static class WindowsAuthenticodeTrust
    {
        private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");

        public static bool IsTrusted(string filePath)
        {
            var fileInfo = new WinTrustFileInfo(filePath);
            var data = new WinTrustData(fileInfo);
            try
            {
                return WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, data) == 0;
            }
            finally
            {
                data.Dispose();
                fileInfo.Dispose();
            }
        }

        [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
        private static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid actionId, WinTrustData data);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class WinTrustFileInfo : IDisposable
        {
            private readonly IntPtr _filePath;
            public uint StructureSize = (uint)Marshal.SizeOf<WinTrustFileInfo>();
            public IntPtr FilePath;
            public IntPtr FileHandle = IntPtr.Zero;
            public IntPtr KnownSubject = IntPtr.Zero;

            public WinTrustFileInfo(string filePath)
            {
                _filePath = Marshal.StringToCoTaskMemUni(filePath);
                FilePath = _filePath;
            }

            public void Dispose() => Marshal.FreeCoTaskMem(_filePath);
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class WinTrustData : IDisposable
        {
            private readonly IntPtr _fileInfo;
            public uint StructureSize = (uint)Marshal.SizeOf<WinTrustData>();
            public IntPtr PolicyCallbackData = IntPtr.Zero;
            public IntPtr SipClientData = IntPtr.Zero;
            public uint UIChoice = 2;
            public uint RevocationChecks = 0;
            public uint UnionChoice = 1;
            public IntPtr FileInfo;
            public uint StateAction = 0;
            public IntPtr StateData = IntPtr.Zero;
            public string? UrlReference = null;
            public uint ProviderFlags = 0x00000080;
            public uint UIContext = 0;

            public WinTrustData(WinTrustFileInfo fileInfo)
            {
                _fileInfo = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
                Marshal.StructureToPtr(fileInfo, _fileInfo, false);
                FileInfo = _fileInfo;
            }

            public void Dispose() => Marshal.FreeCoTaskMem(_fileInfo);
        }
    }
}
