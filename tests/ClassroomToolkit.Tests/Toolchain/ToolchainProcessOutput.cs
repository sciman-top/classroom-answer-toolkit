using System.Text.RegularExpressions;

namespace ClassroomToolkit.Tests.Toolchain;

/// <summary>
/// Normalizes captured pwsh output so that message assertions survive the way
/// the host formats errors. Three effects stack up, and all three have to be
/// handled or a phrase that reads correctly on a developer machine fails on CI:
/// <list type="bullet">
/// <item>ANSI colour escapes are emitted on CI but not when output is
/// redirected locally, and they are inserted inside the message text.</item>
/// <item>Every wrapped line carries the error frame's "|" gutter, which lands
/// between words of a wrapped message.</item>
/// <item>The wrap position depends on the host width, which depends on the
/// checkout path length, so it differs between a local clone and CI.</item>
/// </list>
/// </summary>
internal static class ToolchainProcessOutput
{
    private static readonly Regex AnsiEscape = new(@"\u001B\[[0-9;]*[A-Za-z]", RegexOptions.Compiled);
    private static readonly Regex ErrorFrameGutter = new(@"\r?\n\s*\|\s*", RegexOptions.Compiled);

    public static string Normalize(string output)
    {
        var withoutAnsi = AnsiEscape.Replace(output, string.Empty);
        var withoutGutter = ErrorFrameGutter.Replace(withoutAnsi, " ");
        return string.Join(' ', withoutGutter.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }
}
