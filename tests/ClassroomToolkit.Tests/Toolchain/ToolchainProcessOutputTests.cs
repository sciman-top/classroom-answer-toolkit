using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class ToolchainProcessOutputTests
{
    private const string Phrase = "must be a directory named 'artifacts'";

    [Fact]
    public void Normalize_StripsAnsiEscapes()
    {
        var raw = "\u001B[31;1mRefusing to clean: an artifacts root\u001B[0m";

        ToolchainProcessOutput.Normalize(raw).Should().Be("Refusing to clean: an artifacts root");
    }

    [Fact]
    public void Normalize_JoinsAPhraseSplitByTheErrorFrameGutter()
    {
        // Shape produced by pwsh when a message wraps at the host width.
        var raw = string.Join('\n',
            "     | Refusing to clean 'D:\\repo': an artifacts root must be a",
            "     | directory named 'artifacts'.");

        ToolchainProcessOutput.Normalize(raw).Should().Contain(Phrase);
    }

    [Fact]
    public void Normalize_HandlesAnsiEscapesInsideAWrappedMessage()
    {
        // The CI failure this guards against: ANSI escapes sit between the
        // wrapped halves, so stripping the gutter alone is not enough.
        var raw = string.Join('\n',
            "\u001B[31;1m\u001B[0m\u001B[36;1m | \u001B[31;1mRefusing to clean 'D:\\repo': an artifacts root must be a\u001B[0m",
            "\u001B[31;1m\u001B[0m\u001B[36;1m | \u001B[31;1mdirectory named 'artifacts'.\u001B[0m");

        ToolchainProcessOutput.Normalize(raw).Should().Contain(Phrase);
    }

    [Fact]
    public void Normalize_LeavesPlainSingleLineOutputUnchanged()
    {
        ToolchainProcessOutput.Normalize("Published app not found").Should().Be("Published app not found");
    }
}
