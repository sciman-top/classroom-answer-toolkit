using System.Diagnostics;
using System.IO;

namespace ClassroomToolkit.App.Services;

public sealed class WindowsPathOpener : IPathOpener
{
    public bool TryOpenPath(string path, out string? errorMessage)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                errorMessage = "路径为空。";
                return false;
            }

            var fullPath = Path.GetFullPath(path);
            if (!File.Exists(fullPath) && !Directory.Exists(fullPath))
            {
                errorMessage = $"路径不存在: {fullPath}";
                return false;
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = fullPath,
                UseShellExecute = true
            });

            errorMessage = null;
            return true;
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            return false;
        }
    }
}
