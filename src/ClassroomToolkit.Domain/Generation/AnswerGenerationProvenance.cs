namespace ClassroomToolkit.Domain.Generation;

public sealed record AnswerGenerationProvenance(
    string ProviderKind,
    string ProviderId,
    string ProviderVersion,
    bool LiveProvider,
    string? ProviderSurface = null,
    int? AttemptCount = null,
    bool? CloudEgress = null);
