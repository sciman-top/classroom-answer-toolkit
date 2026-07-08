using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

public sealed class CrossSubjectContractTests
{
    [Fact]
    public void MathSubjectPack_ProvidesMinimalContractAssets()
    {
        var repoRoot = FindRepoRoot();
        var manifestPath = Path.Combine(repoRoot, "prompts", "math-answer", "manifest.json");
        var configPath = Path.Combine(repoRoot, "prompts", "math-answer", "config.json");

        File.Exists(manifestPath).Should().BeTrue();
        File.Exists(configPath).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "spec.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "checklists", "acceptance.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "profiles", "classroom.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "math-answer", "rules", "math-format.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "specs", "assemblies", "math.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "prompts", "specs", "compiled", "试卷参考答案交付规范-初中数学-完整版-v0.1.md")).Should().BeTrue();
        var datasetPath = Path.Combine(repoRoot, "eval", "math-answer", "dataset.json");
        File.Exists(datasetPath).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "basic-probability-notation.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "basic-probability-notation.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "basic-probability-notation.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "basic-probability-notation.compact.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "basic-statistics-summary.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "basic-statistics-summary.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "basic-statistics-summary.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "basic-statistics-summary.compact.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "function-graph-review-fallback.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "function-graph-review-fallback.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "function-graph-review-fallback.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "function-graph-review-fallback.compact.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "geometry-review-fallback.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "geometry-review-fallback.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "geometry-review-fallback.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "geometry-review-fallback.compact.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "chart-driven-review-fallback.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "chart-driven-review-fallback.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "chart-driven-review-fallback.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "chart-driven-review-fallback.compact.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "stepwise-derivation.md")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "cases", "stepwise-derivation.expected.json")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "stepwise-derivation.classroom.page-001.png")).Should().BeTrue();
        File.Exists(Path.Combine(repoRoot, "eval", "math-answer", "baselines", "visual", "stepwise-derivation.compact.page-001.png")).Should().BeTrue();

        using var dataset = JsonDocument.Parse(File.ReadAllText(datasetPath));
        var caseIds = dataset.RootElement.GetProperty("cases").EnumerateArray()
            .Select(static element => element.GetProperty("id").GetString())
            .ToArray();
        caseIds.Should().Contain("basic-probability-notation");
        caseIds.Should().Contain("basic-statistics-summary");
        caseIds.Should().Contain("chart-driven-review-fallback");
        caseIds.Should().Contain("function-graph-review-fallback");
        caseIds.Should().Contain("geometry-review-fallback");
        caseIds.Should().Contain("stepwise-derivation");

        using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
        manifest.RootElement.GetProperty("status").GetString().Should().Be("experimental");
        var manifestSourceOfTruth = manifest.RootElement.GetProperty("sourceOfTruth");
        manifestSourceOfTruth.GetProperty("humanSpec").GetString().Should().Be("../specs/compiled/试卷参考答案交付规范-初中数学-完整版-v0.1.md");
        manifestSourceOfTruth.GetProperty("mirroredSpec").GetString().Should().Be("./spec.md");
        manifestSourceOfTruth.GetProperty("acceptanceChecklist").GetString().Should().Be("./checklists/acceptance.md");
        manifestSourceOfTruth.GetProperty("runtimeConfig").GetString().Should().Be("./config.json");
        manifest.RootElement.GetProperty("evaluation").GetProperty("visualBaselinesDir").GetString().Should().Be("../../eval/math-answer/baselines/visual");
        var tooling = manifest.RootElement.GetProperty("tooling");
        tooling.GetProperty("evalRunner").GetString().Should().Be("../../tools/latex-renderer/eval-answer-fixtures.mjs");
        tooling.GetProperty("renderer").GetString().Should().Be("../../tools/latex-renderer/render-md-latex.mjs");
        tooling.GetProperty("deliver").GetString().Should().Be("../../tools/latex-renderer/deliver-answer.mjs");
        tooling.GetProperty("visualSmoke").GetString().Should().Be("../../tools/latex-renderer/visual-regression-smoke.mjs");

        using var config = JsonDocument.Parse(File.ReadAllText(configPath));
        var configSourceOfTruth = config.RootElement.GetProperty("sourceOfTruth");
        configSourceOfTruth.GetProperty("humanSpec").GetString().Should().Be("../specs/compiled/试卷参考答案交付规范-初中数学-完整版-v0.1.md");
        configSourceOfTruth.GetProperty("mirroredSpec").GetString().Should().Be("./spec.md");
        configSourceOfTruth.GetProperty("acceptanceChecklist").GetString().Should().Be("./checklists/acceptance.md");
        config.RootElement.GetProperty("evaluation").GetProperty("visualBaselinesDir").GetString().Should().Be("../../eval/math-answer/baselines/visual");
    }

    [Fact]
    public void MathSubjectPack_InheritsSharedVisualQuantitativeRules()
    {
        var repoRoot = FindRepoRoot();
        var assemblyPath = Path.Combine(repoRoot, "prompts", "specs", "assemblies", "math.json");
        using var assembly = JsonDocument.Parse(File.ReadAllText(assemblyPath));

        var sourceLayerLabels = assembly.RootElement.GetProperty("sourceLayers").EnumerateArray()
            .Select(static element => element.GetProperty("label").GetString())
            .ToArray();
        sourceLayerLabels.Should().Contain("图文定量题通用");

        var mirroredSpec = File.ReadAllText(Path.Combine(repoRoot, "prompts", "math-answer", "spec.md"));
        mirroredSpec.Should().Contain("视觉证据编译器");
        mirroredSpec.Should().Contain("Track C");
        mirroredSpec.Should().Contain("questionRef -> figureRef -> cropRef -> evidenceRef");
    }

    [Fact]
    public void AssetValidationScript_RequiresAssemblyCoverage_ForEverySubjectPack()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "validate-assets.mjs"));

        script.Should().Contain("is missing prompts/specs/assemblies coverage");
        script.Should().Contain("is referenced by multiple assemblies");
    }

    [Fact]
    public void AssetValidationScript_TracksSampleAndFeedbackSchemaContracts()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "validate-assets.mjs"));

        script.Should().Contain("data-classification.schema.json");
        script.Should().Contain("review-state-machine.schema.json");
        script.Should().Contain("feedback-record.schema.json");
        script.Should().Contain("sample-package.schema.json");
        script.Should().Contain("sample-index.schema.json");
        script.Should().Contain("negative-candidate.schema.json");
        script.Should().Contain("sample-run-record.schema.json");
        script.Should().Contain("schema should declare a non-empty $id");
        script.Should().Contain("schema should declare compatibility metadata");
    }

    [Fact]
    public void AssetValidationScript_TracksVisualEvidenceCompilerSchemaContracts()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "validate-assets.mjs"));
        var schemaRoot = Path.Combine(repoRoot, "prompts", "shared", "schemas");
        var expectedSchemaFiles = new[]
        {
            "normalized-page.schema.json",
            "visual-region.schema.json",
            "problem-evidence-bundle.schema.json",
            "track-result.schema.json",
            "decision-record.schema.json",
            "visual-input-bundle.schema.json",
            "grounding-snapshot.schema.json",
            "solution-snapshot.schema.json",
            "consistency-report.schema.json"
        };

        foreach (var schemaFile in expectedSchemaFiles)
        {
            script.Should().Contain(schemaFile);
            File.Exists(Path.Combine(schemaRoot, schemaFile)).Should().BeTrue();
        }

        using var evidenceBundle = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "problem-evidence-bundle.schema.json")));
        var evidenceBundleRoot = evidenceBundle.RootElement;
        var evidenceBundleRequired = evidenceBundleRoot.GetProperty("required").EnumerateArray()
            .Select(static element => element.GetString())
            .ToArray();
        evidenceBundleRequired.Should().Contain(new[]
        {
            "questionRef",
            "figureRefs",
            "cropRefs",
            "evidenceRefs",
            "risk"
        });

        var evidenceBundleProperties = evidenceBundleRoot.GetProperty("properties");
        evidenceBundleProperties.TryGetProperty("normalizedQuestionRef", out _).Should().BeTrue();
        evidenceBundleProperties.TryGetProperty("ocrRefs", out _).Should().BeTrue();
        evidenceBundleProperties.TryGetProperty("layoutRegionRefs", out _).Should().BeTrue();

        using var trackResult = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "track-result.schema.json")));
        var trackResultText = trackResult.RootElement.ToString();
        trackResultText.Should().Contain("vlm_direct");
        trackResultText.Should().Contain("ocr_layout_solver");
        trackResultText.Should().Contain("rule_validator");
        trackResultText.Should().Contain("evidenceBundleRef");
        trackResultText.Should().Contain("conflictRefs");
        trackResultText.Should().Contain("stageArtifactRefs");

        using var decisionRecord = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "decision-record.schema.json")));
        var decisionRecordText = decisionRecord.RootElement.ToString();
        decisionRecordText.Should().Contain("trusted");
        decisionRecordText.Should().Contain("visualReviewPassed");
        decisionRecordText.Should().Contain("reviewRequired");
        decisionRecordText.Should().Contain("high_risk_approval");
        decisionRecordText.Should().Contain("evidence_chain_missing");
        decisionRecordText.Should().Contain("dual_track_conflict");
        decisionRecordText.Should().Contain("unsafe_shortcut_fail");
        decisionRecordText.Should().Contain("grounding_insufficient");
        decisionRecordText.Should().Contain("acceptance_tier_unverified");
        decisionRecordText.Should().Contain("strict_schema_downgraded");

        using var groundingSnapshot = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "grounding-snapshot.schema.json")));
        var groundingSnapshotText = groundingSnapshot.RootElement.ToString();
        groundingSnapshotText.Should().Contain("sourceImageRefs");
        groundingSnapshotText.Should().Contain("visibleTextBlocks");
        groundingSnapshotText.Should().Contain("diagramRelations");
        groundingSnapshotText.Should().Contain("groundingSufficient");

        using var solutionSnapshot = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "solution-snapshot.schema.json")));
        var solutionSnapshotText = solutionSnapshot.RootElement.ToString();
        solutionSnapshotText.Should().Contain("answersBySubquestion");
        solutionSnapshotText.Should().Contain("usedKnowns");
        solutionSnapshotText.Should().Contain("usedDiagramRelations");
        solutionSnapshotText.Should().Contain("unsupportedClaims");

        using var consistencyReport = JsonDocument.Parse(File.ReadAllText(Path.Combine(schemaRoot, "consistency-report.schema.json")));
        var consistencyReportText = consistencyReport.RootElement.ToString();
        consistencyReportText.Should().Contain("consistencyReportId");
        consistencyReportText.Should().Contain("unsafeShortcutFail");
        consistencyReportText.Should().Contain("recommendedDecisionReasons");
    }

    [Fact]
    public void VisualEvidenceEval_FailClosedWhenDualTrackMatchesButEvidenceIsMissing()
    {
        var repoRoot = FindRepoRoot();
        var datasetPath = Path.Combine(repoRoot, "eval", "visual-evidence", "dataset.json");
        using var dataset = JsonDocument.Parse(File.ReadAllText(datasetPath));
        var failClosedCase = dataset.RootElement.GetProperty("cases").EnumerateArray()
            .Single(element => element.GetProperty("id").GetString() == "dual-track-match-evidence-missing");

        failClosedCase.GetProperty("expectedTrusted").GetBoolean().Should().BeFalse();
        failClosedCase.GetProperty("expectedReviewRequired").GetBoolean().Should().BeTrue();

        var decisionPath = Path.Combine(repoRoot, "eval", "visual-evidence", failClosedCase.GetProperty("decisionRecord").GetString()!);
        using var decisionRecord = JsonDocument.Parse(File.ReadAllText(decisionPath));
        var decision = decisionRecord.RootElement;
        decision.GetProperty("trusted").GetBoolean().Should().BeFalse();
        decision.GetProperty("visualReviewPassed").ValueKind.Should().Be(JsonValueKind.Null);
        decision.GetProperty("reviewRequired").GetBoolean().Should().BeTrue();
        decision.GetProperty("reviewQueue").GetString().Should().Be("high_risk_approval");

        var decisionReasons = decision.GetProperty("decisionReasons").EnumerateArray()
            .Select(static element => element.GetString())
            .ToArray();
        decisionReasons.Should().Contain("dual_track_match");
        decisionReasons.Should().Contain("evidence_chain_missing");
        decisionReasons.Should().Contain("high_risk_visual");
    }

    [Fact]
    public void VisualEvidenceEval_FailClosedWhenAnswerShortcutsPastGrounding()
    {
        var repoRoot = FindRepoRoot();
        var datasetPath = Path.Combine(repoRoot, "eval", "visual-evidence", "dataset.json");
        using var dataset = JsonDocument.Parse(File.ReadAllText(datasetPath));
        var unsafeShortcutCase = dataset.RootElement.GetProperty("cases").EnumerateArray()
            .Single(element => element.GetProperty("id").GetString() == "unsafe-shortcut-grounding-missing");

        unsafeShortcutCase.GetProperty("expectedTrusted").GetBoolean().Should().BeFalse();
        unsafeShortcutCase.GetProperty("expectedReviewRequired").GetBoolean().Should().BeTrue();

        var decisionPath = Path.Combine(repoRoot, "eval", "visual-evidence", unsafeShortcutCase.GetProperty("decisionRecord").GetString()!);
        using var decisionRecord = JsonDocument.Parse(File.ReadAllText(decisionPath));
        var decision = decisionRecord.RootElement;
        decision.GetProperty("trusted").GetBoolean().Should().BeFalse();
        decision.GetProperty("reviewRequired").GetBoolean().Should().BeTrue();

        var decisionReasons = decision.GetProperty("decisionReasons").EnumerateArray()
            .Select(static element => element.GetString())
            .ToArray();
        decisionReasons.Should().Contain("unsafe_shortcut_fail");
        decisionReasons.Should().Contain("grounding_insufficient");
        decisionReasons.Should().Contain("acceptance_tier_unverified");
    }

    [Fact]
    public void EndStateDocs_RecordAutoSolvingWorkstationAndTypstPrimaryRendererPlan()
    {
        var repoRoot = FindRepoRoot();
        var strategyReadme = File.ReadAllText(Path.Combine(repoRoot, "docs", "strategy", "README.md"));
        var workstationPlanPath = Path.Combine(repoRoot, "docs", "strategy", "auto-solving-workstation-final-plan.md");
        var typstPlanPath = Path.Combine(repoRoot, "docs", "strategy", "typst-primary-renderer-plan.md");
        var typstAdrPath = Path.Combine(repoRoot, "docs", "adr", "0006-typst-primary-renderer-target.md");

        File.Exists(workstationPlanPath).Should().BeTrue();
        File.Exists(typstPlanPath).Should().BeTrue();
        File.Exists(typstAdrPath).Should().BeTrue();
        strategyReadme.Should().Contain("auto-solving-workstation-final-plan.md");
        strategyReadme.Should().Contain("typst-primary-renderer-plan.md");

        var workstationPlan = File.ReadAllText(workstationPlanPath);
        workstationPlan.Should().Contain("自动解题工作站");
        workstationPlan.Should().Contain("视觉证据编译器");
        workstationPlan.Should().Contain("answer.md -> PDF/review");
        workstationPlan.Should().Contain("原题 -> answer.md");

        var typstPlan = File.ReadAllText(typstPlanPath);
        typstPlan.Should().Contain("Typst 主渲染");
        typstPlan.Should().Contain("当前运行时仍保持 Playwright / Chromium");
        typstPlan.Should().Contain("parity gate");
        typstPlan.Should().Contain("rollback");

        var typstAdr = File.ReadAllText(typstAdrPath);
        typstAdr.Should().Contain("Status");
        typstAdr.Should().Contain("Accepted target");
        typstAdr.Should().Contain("supersedes D-016");
        typstAdr.Should().Contain("does not switch the current runtime");
    }

    [Fact]
    public void AssetValidationScript_TracksRendererContractSchemaAndEval()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "validate-assets.mjs"));
        var schemaPath = Path.Combine(repoRoot, "prompts", "shared", "schemas", "renderer-contract.schema.json");
        var datasetPath = Path.Combine(repoRoot, "eval", "renderer-contract", "dataset.json");

        File.Exists(schemaPath).Should().BeTrue();
        File.Exists(datasetPath).Should().BeTrue();
        script.Should().Contain("renderer-contract.schema.json");
        script.Should().Contain("eval/renderer-contract");

        using var schema = JsonDocument.Parse(File.ReadAllText(schemaPath));
        var schemaText = schema.RootElement.ToString();
        schemaText.Should().Contain("rendererId");
        schemaText.Should().Contain("engine");
        schemaText.Should().Contain("playwright_chromium");
        schemaText.Should().Contain("typst");
        schemaText.Should().Contain("acceptanceGates");

        using var dataset = JsonDocument.Parse(File.ReadAllText(datasetPath));
        var firstCase = dataset.RootElement.GetProperty("cases").EnumerateArray().First();
        firstCase.GetProperty("targetRenderer").GetString().Should().Be("typst");
        firstCase.GetProperty("currentRenderer").GetString().Should().Be("playwright_chromium");
        firstCase.GetProperty("status").GetString().Should().Be("planned");
    }

    [Fact]
    public void AiGatewayConfig_RecordsSecretBoundaryAndValidationContract()
    {
        var repoRoot = FindRepoRoot();
        var gitignore = File.ReadAllText(Path.Combine(repoRoot, ".gitignore"));
        var envExamplePath = Path.Combine(repoRoot, ".env.example");
        var gatewayDocPath = Path.Combine(repoRoot, "docs", "strategy", "ai-gateway-config.md");
        var strategyReadme = File.ReadAllText(Path.Combine(repoRoot, "docs", "strategy", "README.md"));
        var packageJson = File.ReadAllText(Path.Combine(repoRoot, "tools", "ai-gateway", "package.json"));
        var validator = File.ReadAllText(Path.Combine(repoRoot, "tools", "ai-gateway", "validate-config.mjs"));
        var checkToolchain = File.ReadAllText(Path.Combine(repoRoot, "scripts", "check-toolchain.ps1"));

        gitignore.Should().Contain(".env");
        gitignore.Should().Contain(".env.*");
        gitignore.Should().Contain("!.env.example");
        File.Exists(envExamplePath).Should().BeTrue();
        File.Exists(gatewayDocPath).Should().BeTrue();

        var envExample = File.ReadAllText(envExamplePath);
        envExample.Should().Contain("CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        envExample.Should().Contain("CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL=https://primary.example.com/v1");
        envExample.Should().Contain("CLASSROOM_TOOLKIT_IMAGE_PRIMARY_MODEL=gpt-image-2");
        envExample.Should().NotContain("TEXT_PROVIDER_API_KEY=");
        envExample.Should().NotContain("IMAGE_PROVIDER_API_KEY_1=");

        strategyReadme.Should().Contain("ai-gateway-config.md");
        File.ReadAllText(gatewayDocPath).Should().Contain("TEXT_PROVIDER_*");
        File.ReadAllText(gatewayDocPath).Should().Contain("live 探针通过只证明 provider 的文本入口可达");
        packageJson.Should().Contain("validate:config");
        packageJson.Should().Contain("probe:text");
        packageJson.Should().Contain("request:text");
        validator.Should().Contain("CLASSROOM_TOOLKIT_AI_PRIMARY");
        validator.Should().Contain("TEXT_PROVIDER_FALLBACK_1");
        validator.Should().Contain("--allow-cloud-egress");
        validator.Should().Contain("requestTextWithFailover");
        validator.Should().Contain("isRetryableGatewayFailure");
        validator.Should().Contain("408, 409, 425, 429, 500, 502, 503, 504");
        File.ReadAllText(Path.Combine(repoRoot, "tools", "ai-gateway", "text-request.mjs"))
            .Should().Contain("--force-primary-failure");
        checkToolchain.Should().Contain("tools/ai-gateway run validate:config");
        checkToolchain.Should().Contain("--config-env-file .env.example --allow-missing-secrets");
    }

    [Fact]
    public void AiGatewayVisionProbe_StaysExplicitAndSchemaBound()
    {
        var repoRoot = FindRepoRoot();
        var packageJson = File.ReadAllText(Path.Combine(repoRoot, "tools", "ai-gateway", "package.json"));
        var visionRequestPath = Path.Combine(repoRoot, "tools", "ai-gateway", "vision-request.mjs");
        var gatewayDoc = File.ReadAllText(Path.Combine(repoRoot, "docs", "strategy", "ai-gateway-config.md"));
        var readme = File.ReadAllText(Path.Combine(repoRoot, "README.md"));
        var checkToolchain = File.ReadAllText(Path.Combine(repoRoot, "scripts", "check-toolchain.ps1"));

        File.Exists(visionRequestPath).Should().BeTrue();
        packageJson.Should().Contain("request:vision");
        packageJson.Should().Contain("test:vision");
        checkToolchain.Should().Contain("test:vision");

        var visionRequest = File.ReadAllText(visionRequestPath);
        visionRequest.Should().Contain("requestVisionWithFailover");
        visionRequest.Should().Contain("track-result.schema.json");
        visionRequest.Should().Contain("data:image/png;base64");
        visionRequest.Should().Contain("chat/completions");
        visionRequest.Should().Contain("responses");
        visionRequest.Should().Contain("requestedVisualDetailMode");
        visionRequest.Should().Contain("providerVisualDetailMode");

        gatewayDoc.Should().Contain("视觉 live 探针通过只证明 provider 的显式图片理解入口可达");
        gatewayDoc.Should().Contain("TrackResult");
        gatewayDoc.Should().Contain("不等于 workflow integrated 或 live accepted");
        readme.Should().Contain("显式开启云外发后，可用合成图片验证主备视觉请求级切换");
    }

    [Fact]
    public void RuleCompiler_ExposesCrossSubjectValidationScript()
    {
        var repoRoot = FindRepoRoot();
        var packageJson = File.ReadAllText(Path.Combine(repoRoot, "tools", "rule-compiler", "package.json"));

        packageJson.Should().Contain("validate:cross-subject");
    }

    [Fact]
    public void SubjectPackToolingScript_ExposesSharedSubjectPackDiscovery()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "subject-pack-tooling.ps1"));

        script.Should().Contain("function Get-SubjectPackMetadata");
        script.Should().Contain("manifest.json");
        script.Should().Contain("function Get-SubjectPackSnapshotOutputPath");
        script.Should().Contain("snapshot.cachePath");
    }

    [Fact]
    public void CheckToolchain_UsesDiscoveredSubjectPacks_ForSnapshotsAndEval()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "check-toolchain.ps1"));

        script.Should().Contain("Get-SubjectPackMetadata -RepositoryRoot $repoRoot");
        script.Should().Contain("Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile");
        script.Should().Contain("node tools/latex-renderer/eval-answer-fixtures.mjs --subject-pack $subjectPack.AssetId");
    }

    [Fact]
    public void Bootstrap_UsesDiscoveredSubjectPacks_ForSnapshotCompilation()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "bootstrap.ps1"));

        script.Should().Contain("Get-SubjectPackMetadata -RepositoryRoot $repoRoot");
        script.Should().Contain("Get-SubjectPackSnapshotOutputPath -SubjectPack $subjectPack -Profile $profile");
    }

    [Fact]
    public void Bootstrap_ChecksDotNetSdkAcrossInstalledSdkLines_AndTreatsAnswerGraphicsAsOnDemand()
    {
        var repoRoot = FindRepoRoot();
        var script = File.ReadAllText(Path.Combine(repoRoot, "scripts", "bootstrap.ps1"));

        script.Should().Contain("$sdkOutput -split [Environment]::NewLine");
        script.Should().Contain("Where-Object { $_ -match ('^{0}\\s+\\[' -f [regex]::Escape($Version)) }");
        script.Should().Contain("Test-DotNetSdkInstalled -Version \"10.0.301\"");
        script.Should().Contain("Skipping tools/answer-graphics bootstrap; this experimental toolchain is installed on demand.");
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "ClassroomToolkit.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Repository root not found.");
    }
}
