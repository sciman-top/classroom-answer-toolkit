using ClassroomToolkit.Domain.Delivery;
using ClassroomToolkit.Domain.Generation;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class AnswerGenerationContractTests
{
    [Fact]
    public void GenerationRequestIsSeparateFromDeliveryRequest()
    {
        var generationProperties = typeof(AnswerGenerationRequest)
            .GetProperties()
            .Select(property => property.Name)
            .ToHashSet(StringComparer.Ordinal);
        var deliveryProperties = typeof(AnswerDeliveryRequest)
            .GetProperties()
            .Select(property => property.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Contains("ProblemArtifactRef", generationProperties);
        Assert.Contains("ProblemArtifactSha256", generationProperties);
        Assert.Contains("InstructionAuthority", generationProperties);
        Assert.Contains("EgressPolicy", generationProperties);
        Assert.DoesNotContain("AnswerMarkdownPath", generationProperties);
        Assert.DoesNotContain("OutputPdfPath", generationProperties);
        Assert.DoesNotContain("Profile", generationProperties);
        Assert.DoesNotContain("KeepReviewArtifacts", generationProperties);
        Assert.DoesNotContain("ProblemArtifactRef", deliveryProperties);
    }

    [Fact]
    public void SyntheticResultCarriesExplicitNonLiveProvenance()
    {
        var provenance = new AnswerGenerationProvenance(
            ProviderKind: "synthetic_fixture",
            ProviderId: "deterministic-local-generator",
            ProviderVersion: "1.0.0",
            LiveProvider: false);
        var classification = new AnswerGenerationDataClassification(
            Level: "public",
            Notes: "Fully synthetic deterministic generation fixture.");
        var result = new AnswerGenerationResult(
            RequestId: "synthetic-arithmetic-slip",
            SubjectPack: "math-answer",
            SourceRequestSha256: new string('a', 64),
            AnswerMarkdown: "`x = 2`\n",
            CandidateArtifactRef: "candidate.md",
            RawAnswerSha256: new string('b', 64),
            DataClassification: classification,
            Provenance: provenance,
            StopReason: "synthetic_fixture_generated_no_live_provider");

        Assert.Equal("synthetic_fixture", result.Provenance.ProviderKind);
        Assert.False(result.Provenance.LiveProvider);
        Assert.Equal("public", result.DataClassification.Level);
    }

    [Fact]
    public void ProviderResultCarriesFailClosedReviewDisposition()
    {
        var result = new AnswerGenerationResult(
            RequestId: "provider-linear-equation",
            SubjectPack: "math-answer",
            SourceRequestSha256: new string('a', 64),
            AnswerMarkdown: "`x = 4`\n",
            CandidateArtifactRef: "answer.md",
            RawAnswerSha256: new string('b', 64),
            DataClassification: new AnswerGenerationDataClassification("public", "Public problem."),
            Provenance: new AnswerGenerationProvenance(
                "model_provider", "fallback_1", "model-b", true, "chat_completions", 2, true),
            StopReason: "provider_generated_pending_review",
            GenerationDisposition: new AnswerGenerationDisposition(true, false, "pending_review", "not_integrated"));

        Assert.True(result.Provenance.LiveProvider);
        Assert.True(result.Provenance.CloudEgress);
        Assert.NotNull(result.GenerationDisposition);
        Assert.True(result.GenerationDisposition.ReviewRequired);
        Assert.False(result.GenerationDisposition.Trusted);
    }
}
