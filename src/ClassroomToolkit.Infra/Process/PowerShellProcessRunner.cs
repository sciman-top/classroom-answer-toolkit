using System.Diagnostics;
using System.Text;
using ClassroomToolkit.Infra.Abstractions;

namespace ClassroomToolkit.Infra.Process;

public sealed class PowerShellProcessRunner : IProcessRunner
{
    public async Task<ProcessRunResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken = default)
    {
        var start = DateTimeOffset.Now;
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // pwsh and node emit UTF-8; without this the host code page (GBK on zh-CN)
            // garbles Chinese file names in captured diagnostics.
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new System.Diagnostics.Process { StartInfo = startInfo };
        cancellationToken.ThrowIfCancellationRequested();
        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start process: {fileName}");
        }

        using var registration = cancellationToken.Register(() =>
        {
            if (!process.HasExited)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch
                {
                    // Best effort cancellation only.
                }
            }
        });

        var standardOutputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var standardErrorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken);
        var standardOutput = await standardOutputTask;
        var standardError = await standardErrorTask;

        return new ProcessRunResult(
            process.ExitCode,
            standardOutput,
            standardError,
            DateTimeOffset.Now - start);
    }
}
