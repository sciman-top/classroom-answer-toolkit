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

    [Fact]
    public void ResolveRepositoryRoot_HonorsExplicitOverride_WhenOverrideLooksLikeRepositoryRoot()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(tempRoot, "scripts"));
        File.WriteAllText(Path.Combine(tempRoot, "global.json"), "{}");
        File.WriteAllText(Path.Combine(tempRoot, "ClassroomToolkit.sln"), "");

        try
        {
            var resolver = new RepositoryRootResolver(Path.Combine(tempRoot, "nested"), tempRoot);
            var resolvedRoot = resolver.ResolveRepositoryRoot();

            resolvedRoot.Should().Be(tempRoot);
        }
        finally
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    [Fact]
    public void ResolveRepositoryRoot_FindsPackagedRuntimeRoot()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-runtime-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(tempRoot, "tools"));
        Directory.CreateDirectory(Path.Combine(tempRoot, "prompts"));
        Directory.CreateDirectory(Path.Combine(tempRoot, "runtime", "node"));
        File.WriteAllText(Path.Combine(tempRoot, "runtime-manifest.json"), "{}");
        File.WriteAllText(Path.Combine(tempRoot, "runtime", "node", "node.exe"), "node");

        try
        {
            var nestedDirectory = Path.Combine(tempRoot, "user-data", "papers");
            Directory.CreateDirectory(nestedDirectory);
            new RepositoryRootResolver(nestedDirectory).ResolveRepositoryRoot().Should().Be(tempRoot);
        }
        finally
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
