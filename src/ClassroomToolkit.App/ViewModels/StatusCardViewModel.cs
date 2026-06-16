namespace ClassroomToolkit.App.ViewModels;

public sealed record StatusCardViewModel(
    string Title,
    string Value,
    string Detail,
    bool IsHealthy);
