using ClassroomToolkit.Infra.Workspace;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Workspace;

public sealed class RepositoryRootResolverTests
{
    [Fact]
    public void ResolveRepositoryRoot_FindsAncestorContainingRepoMarkers()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-{Guid.NewGuid():N}");
        var nestedDirectory = Path.Combine(tempRoot, "alpha", "beta", "gamma");
        Directory.CreateDirectory(nestedDirectory);
        Directory.CreateDirectory(Path.Combine(tempRoot, "scripts"));
        File.WriteAllText(Path.Combine(tempRoot, "global.json"), "{}");
        File.WriteAllText(Path.Combine(tempRoot, "ClassroomToolkit.sln"), "");

        try
        {
            var resolver = new RepositoryRootResolver(nestedDirectory);
            var resolvedRoot = resolver.ResolveRepositoryRoot();

            resolvedRoot.Should().Be(tempRoot);
        }
        finally
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
