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
    string PackageUrl,
    string PackageSha256,
    long PackageBytes);

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

internal enum InstalledApplicationState
{
    NotInstalledCopy,
    UpdateReady,
    ManifestUnreadable
}

public sealed class ReleaseUpdateService : IUpdateService, IDisposable
{
    public const string DefaultManifestUrl =
        "https://github.com/sciman-top/classroom-answer-toolkit/releases/latest/download/update-manifest.json";

    private static readonly Version DevelopmentVersion = new(0, 0, 0);
    private const string LegacyWorkspaceContract = "1";
    private const long MaximumDownloadBytes = 1024L * 1024L * 1024L;
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
        var installedState = GetInstalledApplicationState();
        if (installedState == InstalledApplicationState.ManifestUnreadable)
        {
            // Fail closed and loudly: a corrupt manifest must not look like "no update".
            return UpdateCheckResult.Unavailable("安装版 runtime-manifest.json 无法解析；请重新安装或修复应用后再检查更新");
        }

        if (installedState != InstalledApplicationState.UpdateReady)
        {
            return UpdateCheckResult.NoUpdate("当前是源码/调试运行，跳过安装版更新检查");
        }

        try
        {
            if (!Uri.TryCreate(_manifestUrl, UriKind.Absolute, out var manifestUri))
            {
                return UpdateCheckResult.Unavailable("更新清单 URL 无效");
            }

            using var response = await GetApprovedResponseAsync(
                manifestUri,
                HttpCompletionOption.ResponseContentRead,
                cancellationToken).ConfigureAwait(false);
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
            if (!string.Equals(manifest.Kind, "classroom-toolkit-update-manifest", StringComparison.Ordinal)
                || !string.Equals(manifest.SchemaVersion, "2.0", StringComparison.Ordinal))
            {
                // Only the stable 2.0 manifest carries the installer asset the
                // auto-update flow consumes; anything else needs a manual setup.
                return UpdateCheckResult.Unavailable("更新清单 schema 不受支持，请手动下载新安装程序");
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
                asset.Url!,
                asset.Sha256!.ToLowerInvariant(),
                asset.Bytes));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException
            or IOException
            or JsonException
            or InvalidDataException
            or InvalidOperationException
            or UriFormatException
            or OperationCanceledException)
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
        var installedState = GetInstalledApplicationState();
        if (installedState == InstalledApplicationState.ManifestUnreadable)
        {
            return new UpdateInstallResult(false, "安装版 runtime-manifest.json 无法解析；请重新安装或修复应用");
        }

        if (installedState != InstalledApplicationState.UpdateReady)
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
        var started = false;
        try
        {
            if (!Uri.TryCreate(update.PackageUrl, UriKind.Absolute, out var packageUri))
            {
                throw new InvalidDataException("更新资产 URL 无效");
            }

            using var response = await GetApprovedResponseAsync(
                packageUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            // Reject a mismatched payload before streaming it to disk so a
            // redirected or oversized asset cannot consume unbounded space.
            var declaredContentLength = response.Content.Headers.ContentLength;
            if (declaredContentLength is long contentLength && contentLength != update.PackageBytes)
            {
                throw new InvalidDataException($"更新安装程序大小不匹配：expected {update.PackageBytes}, actual {contentLength}");
            }

            await CopyResponseToFileBoundedAsync(
                response.Content,
                setupPath,
                update.PackageBytes,
                cancellationToken).ConfigureAwait(false);

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
            // X509CertificateLoader.LoadCertificateFromFile expects a
            // certificate file, not a PE image. Extract the Authenticode
            // signer from the signed setup executable itself.
#pragma warning disable SYSLIB0057 // PE Authenticode extraction has no X509CertificateLoader equivalent.
            using var signer = X509Certificate.CreateFromSignedFile(setupPath);
#pragma warning restore SYSLIB0057
            if (!string.Equals(
                signer.GetCertHashString(),
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
            started = true;
            return new UpdateInstallResult(true, $"已启动 {update.Version} 安装程序，应用即将重启");
        }
        catch (Exception ex) when (ex is HttpRequestException
            or IOException
            or InvalidDataException
            or UnauthorizedAccessException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception
            or CryptographicException)
        {
            return new UpdateInstallResult(false, $"无法启动更新安装程序：{ex.Message}");
        }
        finally
        {
            // Every failure path (integrity, trust, launch, cancellation)
            // must remove the staged installer; only a started installer
            // legitimately keeps the file alive.
            if (!started)
            {
                try
                {
                    if (File.Exists(setupPath))
                    {
                        File.Delete(setupPath);
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                }
            }
        }
    }

    public void Dispose()
    {
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }

    /// <summary>
    /// Distinguishes "this is not an installed copy" from "this is an installed
    /// copy whose runtime manifest is present but unreadable". The latter used to
    /// be reported as a successful "no update", silently disabling update checks.
    /// </summary>
    private InstalledApplicationState GetInstalledApplicationState()
    {
        if (!string.Equals(
            _applicationDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            _repositoryRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase))
        {
            return InstalledApplicationState.NotInstalledCopy;
        }

        var runtimeManifest = ReadRuntimeManifest(out var unreadable);
        if (unreadable)
        {
            return InstalledApplicationState.ManifestUnreadable;
        }

        return string.Equals(runtimeManifest?.DistributionMode, "installer", StringComparison.OrdinalIgnoreCase)
            && File.Exists(Path.Combine(_applicationDirectory, "ClassroomToolkit.App.exe"))
            ? InstalledApplicationState.UpdateReady
            : InstalledApplicationState.NotInstalledCopy;
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

    private static string FormatVersion(Version version) =>
        // A two-part version carries Build == -1; printing it raw would render "1.2.-1".
        version.Build < 0
            ? $"{version.Major}.{version.Minor}"
            : $"{version.Major}.{version.Minor}.{version.Build}";

    private string GetInstalledWorkspaceContract()
    {
        return ParseWorkspaceContract(ReadRuntimeManifest()?.WorkspaceContract) ?? LegacyWorkspaceContract;
    }

    private RuntimeManifest? ReadRuntimeManifest() => ReadRuntimeManifest(out _);

    private RuntimeManifest? ReadRuntimeManifest(out bool unreadable)
    {
        unreadable = false;
        var manifestPath = Path.Combine(_repositoryRoot, "runtime-manifest.json");
        if (!File.Exists(manifestPath))
        {
            return null;
        }

        try
        {
            using var stream = File.OpenRead(manifestPath);
            var manifest = JsonSerializer.Deserialize<RuntimeManifest>(stream,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (manifest is null)
            {
                // Present but empty is corruption, not absence.
                unreadable = true;
            }

            return manifest;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            unreadable = true;
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

        if (bytes <= 0)
        {
            return "更新资产大小必须为正数";
        }

        return bytes <= MaximumDownloadBytes
            ? null
            : $"更新资产大小超过允许上限 {MaximumDownloadBytes} bytes";
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ClassroomToolkit-UpdateClient/1.0");
        return client;
    }

    private async Task<HttpResponseMessage> GetApprovedResponseAsync(
        Uri initialUri,
        HttpCompletionOption completionOption,
        CancellationToken cancellationToken)
    {
        var currentUri = initialUri;
        for (var redirect = 0; redirect <= 5; redirect++)
        {
            EnsureAllowedDownloadUri(currentUri);
            using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            var response = await _httpClient.SendAsync(request, completionOption, cancellationToken).ConfigureAwait(false);
            if (IsRedirect(response.StatusCode))
            {
                if (redirect >= 5 || response.Headers.Location is null)
                {
                    response.Dispose();
                    throw new InvalidDataException("更新下载 redirect 链无效或过长");
                }

                var nextUri = response.Headers.Location.IsAbsoluteUri
                    ? response.Headers.Location
                    : new Uri(currentUri, response.Headers.Location);
                response.Dispose();
                currentUri = nextUri;
                continue;
            }

            // The client is configured with auto-redirect disabled. Check the
            // final request URI as a defense-in-depth guard for injected/custom
            // handlers that may still follow redirects internally.
            EnsureAllowedDownloadUri(response.RequestMessage?.RequestUri ?? currentUri);
            return response;
        }

        throw new InvalidDataException("更新下载 redirect 链过长");
    }

    private static bool IsRedirect(HttpStatusCode statusCode) =>
        statusCode is HttpStatusCode.MovedPermanently
            or HttpStatusCode.Found
            or HttpStatusCode.SeeOther
            or HttpStatusCode.TemporaryRedirect
            or HttpStatusCode.PermanentRedirect;

    private static void EnsureAllowedDownloadUri(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttps || !IsAllowedDownloadHost(uri.Host))
        {
            throw new InvalidDataException($"更新下载 redirect 指向不受信任的地址：{uri}");
        }
    }

    private static async Task CopyResponseToFileBoundedAsync(
        HttpContent content,
        string targetPath,
        long expectedBytes,
        CancellationToken cancellationToken)
    {
        if (expectedBytes <= 0 || expectedBytes > MaximumDownloadBytes)
        {
            throw new InvalidDataException($"更新安装程序大小超出允许范围：{expectedBytes} bytes");
        }

        await using var source = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        await using var destination = new FileStream(
            targetPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            1024 * 128,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[1024 * 128];
        long totalBytes = 0;
        int read;
        while ((read = await source.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false)) > 0)
        {
            totalBytes += read;
            if (totalBytes > expectedBytes || totalBytes > MaximumDownloadBytes)
            {
                throw new InvalidDataException("更新安装程序超过声明的大小限制");
            }

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        if (totalBytes != expectedBytes)
        {
            throw new InvalidDataException($"更新安装程序大小不匹配：expected {expectedBytes}, actual {totalBytes}");
        }
    }

    private sealed class ReleaseUpdateManifest
    {
        public string? SchemaVersion { get; set; }
        public string? Kind { get; set; }
        public string? Version { get; set; }
        public string? WorkspaceContract { get; set; }
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
            public uint UIChoice = 2; // WTD_UI_NONE
            // WTD_REVOKE_NONE here on purpose: online revocation is enforced
            // via ProviderFlags (WTD_REVOCATION_CHECK_ONLINE). Setting
            // WTD_REVOKE_WHOLECHAIN instead crashed wintrust.dll on malformed
            // unsigned input (native AV), so do not "harden" this field.
            public uint RevocationChecks = 0; // WTD_REVOKE_NONE
            public uint UnionChoice = 1; // WTD_CHOICE_FILE
            public IntPtr FileInfo;
            public uint StateAction = 0;
            public IntPtr StateData = IntPtr.Zero;
            public string? UrlReference = null;
            public uint ProviderFlags = 0x00000080; // WTD_REVOCATION_CHECK_ONLINE
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
