namespace ClassroomToolkit.App.Services;

public interface IPathOpener
{
    bool TryOpenPath(string path, out string? errorMessage);
}
