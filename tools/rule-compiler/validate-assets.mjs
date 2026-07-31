import fs from "node:fs";
import path from "node:path";
import { buildMergedAssets, compileResolvedSnapshot } from "./merge-rules.mjs";
import { listJsonFiles, readJsonFile, resolveRepoPath } from "./shared.mjs";
import { validateJsonFileAgainstSchema, validateValueAgainstSchema } from "./schema-validator.mjs";
import { checkAssemblyOutputs } from "../spec-assembler/assemble-human-spec.mjs";
import { validateCanonicalSampleAuthorities } from "../sample-flywheel/sample-run.mjs";
import { validateOptimizationReadinessReport } from "../sample-flywheel/optimization-readiness.mjs";
import { validateCanonicalTeacherFeedbackFixtures } from "../sample-flywheel/teacher-feedback-parse.mjs";
import {
  validateTeacherFeedbackDiagnosticReport,
  validateTeacherFeedbackReplayDiagnosticReport
} from "../sample-flywheel/teacher-feedback-diagnostic.mjs";
import { validateCanonicalSyntheticGenerationFixtures } from "../answer-generator/synthetic-generator.mjs";
import { validateVisualRiskDiagnosticReport } from "../visual-evidence/visual-risk-diagnostic.mjs";
import { validateVisualOcrRegionAssociationBoundary } from "../visual-ocr-region-association/validate_schema_boundary.mjs";
import { validateVisualSemanticProjectionBoundary } from "../visual-semantic-projector/validate_schema_boundary.mjs";
import { validateVisualRegionSemanticsBoundary } from "../visual-region-semantics/validate_schema_boundary.mjs";
import { validateVisualComponentSemanticsBoundary } from "../visual-component-semantics/validate_schema_boundary.mjs";

function collectValidationTargets() {
  const dataClassificationSchema = resolveRepoPath("prompts/shared/schemas/data-classification.schema.json");
  const manifestSchema = resolveRepoPath("prompts/shared/schemas/manifest.schema.json");
  const runtimeConfigSchema = resolveRepoPath("prompts/shared/schemas/runtime-config.schema.json");
  const rulePackSchema = resolveRepoPath("prompts/shared/schemas/rule-pack.schema.json");
  const profileSchema = resolveRepoPath("prompts/shared/schemas/profile.schema.json");
  const snapshotSchema = resolveRepoPath("prompts/shared/schemas/snapshot.schema.json");
  const deliveryManifestSchema = resolveRepoPath("prompts/shared/schemas/delivery-manifest.schema.json");
  const reviewStateMachineSchema = resolveRepoPath("prompts/shared/schemas/review-state-machine.schema.json");
  const feedbackRecordSchema = resolveRepoPath("prompts/shared/schemas/feedback-record.schema.json");
  const feedbackParseResultSchema = resolveRepoPath("prompts/shared/schemas/feedback-parse-result.schema.json");
  const teacherFeedbackSubmissionSchema = resolveRepoPath("prompts/shared/schemas/teacher-feedback-submission.schema.json");
  const teacherFeedbackFixtureInventorySchema = resolveRepoPath("prompts/shared/schemas/teacher-feedback-fixture-inventory.schema.json");
  const teacherFeedbackDiagnosticReportSchema = resolveRepoPath("prompts/shared/schemas/teacher-feedback-diagnostic-report.schema.json");
  const teacherFeedbackReplayDiagnosticReportSchema = resolveRepoPath("prompts/shared/schemas/teacher-feedback-replay-diagnostic-report.schema.json");
  const answerGenerationRequestSchema = resolveRepoPath("prompts/shared/schemas/answer-generation-request.schema.json");
  const answerGenerationResultSchema = resolveRepoPath("prompts/shared/schemas/answer-generation-result.schema.json");
  const samplePackageSchema = resolveRepoPath("prompts/shared/schemas/sample-package.schema.json");
  const sampleIndexSchema = resolveRepoPath("prompts/shared/schemas/sample-index.schema.json");
  const negativeCandidateSchema = resolveRepoPath("prompts/shared/schemas/negative-candidate.schema.json");
  const releaseQualificationSchema = resolveRepoPath("prompts/shared/schemas/release-qualification.schema.json");
  const sampleRunRecordSchema = resolveRepoPath("prompts/shared/schemas/sample-run-record.schema.json");
  const optimizationReadinessCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/optimization-readiness-case-inventory.schema.json");
  const optimizationReadinessInputSchema = resolveRepoPath("prompts/shared/schemas/optimization-readiness-input.schema.json");
  const optimizationReadinessReportSchema = resolveRepoPath("prompts/shared/schemas/optimization-readiness-report.schema.json");
  const readinessControlReceiptSchema = resolveRepoPath("prompts/shared/schemas/readiness-control-receipt.schema.json");
  const problemEvidenceBundleSchema = resolveRepoPath("prompts/shared/schemas/problem-evidence-bundle.schema.json");
  const trackResultSchema = resolveRepoPath("prompts/shared/schemas/track-result.schema.json");
  const decisionRecordSchema = resolveRepoPath("prompts/shared/schemas/decision-record.schema.json");
  const visualRiskCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-risk-case-inventory.schema.json");
  const visualRiskDiagnosticReportSchema = resolveRepoPath("prompts/shared/schemas/visual-risk-diagnostic-report.schema.json");
  const visualPreprocessingRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-preprocessing-request.schema.json");
  const visualPreprocessingResultSchema = resolveRepoPath("prompts/shared/schemas/visual-preprocessing-result.schema.json");
  const visualPreprocessingCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-preprocessing-case-inventory.schema.json");
  const visualPageNormalizationRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-page-normalization-request.schema.json");
  const visualPageNormalizationResultSchema = resolveRepoPath("prompts/shared/schemas/visual-page-normalization-result.schema.json");
  const visualRegionProposalRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-region-proposal-request.schema.json");
  const visualRegionProposalResultSchema = resolveRepoPath("prompts/shared/schemas/visual-region-proposal-result.schema.json");
  const visualLocalCropRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-local-crop-request.schema.json");
  const visualLocalCropResultSchema = resolveRepoPath("prompts/shared/schemas/visual-local-crop-result.schema.json");
  const visualSyntheticRegionSemanticsDeclarationSchema = resolveRepoPath("prompts/shared/schemas/visual-synthetic-region-semantics-declaration.schema.json");
  const visualRegionSemanticsRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-region-semantics-request.schema.json");
  const visualRegionSemanticsResultSchema = resolveRepoPath("prompts/shared/schemas/visual-region-semantics-result.schema.json");
  const visualSyntheticComponentSemanticsDeclarationSchema = resolveRepoPath("prompts/shared/schemas/visual-synthetic-component-semantics-declaration.schema.json");
  const visualComponentSemanticsRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-component-semantics-request.schema.json");
  const visualComponentSemanticsResultSchema = resolveRepoPath("prompts/shared/schemas/visual-component-semantics-result.schema.json");
  const visualStructureExtractionRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-structure-extraction-request.schema.json");
  const visualStructureExtractionResultSchema = resolveRepoPath("prompts/shared/schemas/visual-structure-extraction-result.schema.json");
  const visualStructureExtractionCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-structure-extraction-case-inventory.schema.json");
  const visualOcrObservationRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-observation-request.schema.json");
  const visualOcrObservationResultSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-observation-result.schema.json");
  const visualOcrObservationCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-observation-case-inventory.schema.json");
  const visualSpatialObservationRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-spatial-observation-request.schema.json");
  const visualSpatialObservationResultSchema = resolveRepoPath("prompts/shared/schemas/visual-spatial-observation-result.schema.json");
  const visualSpatialObservationCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-spatial-observation-case-inventory.schema.json");
  const visualSyntheticTextTruthSchema = resolveRepoPath("prompts/shared/schemas/visual-synthetic-text-truth.schema.json");
  const visualOcrDiagnosticCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-diagnostic-case-inventory.schema.json");
  const visualOcrDiagnosticReportSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-diagnostic-report.schema.json");
  const visualTextRegionDiagnosticCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-text-region-diagnostic-case-inventory.schema.json");
  const visualTextRegionDiagnosticReportSchema = resolveRepoPath("prompts/shared/schemas/visual-text-region-diagnostic-report.schema.json");
  const visualMachineReviewReceiptSchema = resolveRepoPath("prompts/shared/schemas/visual-machine-review-receipt.schema.json");
  const visualMachineReviewCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-machine-review-case-inventory.schema.json");
  const visualMachineReviewReportSchema = resolveRepoPath("prompts/shared/schemas/visual-machine-review-report.schema.json");
  const visualOcrRegionAssociationRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-region-association-request.schema.json");
  const visualOcrRegionAssociationResultSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-region-association-result.schema.json");
  const visualOcrRegionAssociationCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-region-association-case-inventory.schema.json");
  const visualOcrRegionAssociationReportSchema = resolveRepoPath("prompts/shared/schemas/visual-ocr-region-association-report.schema.json");
  const visualSyntheticSemanticDeclarationSchema = resolveRepoPath("prompts/shared/schemas/visual-synthetic-semantic-declaration.schema.json");
  const visualSemanticProjectionRequestSchema = resolveRepoPath("prompts/shared/schemas/visual-semantic-projection-request.schema.json");
  const visualSemanticProjectionResultSchema = resolveRepoPath("prompts/shared/schemas/visual-semantic-projection-result.schema.json");
  const visualSemanticProjectionCaseInventorySchema = resolveRepoPath("prompts/shared/schemas/visual-semantic-projection-case-inventory.schema.json");
  const visualSemanticProjectionReportSchema = resolveRepoPath("prompts/shared/schemas/visual-semantic-projection-report.schema.json");
  const visualSyntheticQuestionSchema = resolveRepoPath("prompts/shared/schemas/visual-synthetic-question.schema.json");
  const ocrLayoutSolverRequestSchema = resolveRepoPath("prompts/shared/schemas/ocr-layout-solver-request.schema.json");
  const syntheticTrackValidatorRequestSchema = resolveRepoPath("prompts/shared/schemas/synthetic-track-validator-request.schema.json");
  const deliveryQuestionCoverageSchema = resolveRepoPath("prompts/shared/schemas/delivery-question-coverage.schema.json");
  const deliveryDecisionAggregateSchema = resolveRepoPath("prompts/shared/schemas/delivery-decision-aggregate.schema.json");
  const deliveryDecisionAggregateAttachmentReceiptSchema = resolveRepoPath("prompts/shared/schemas/delivery-decision-aggregate-attachment-receipt.schema.json");
  const reviewQueueProjectionSchema = resolveRepoPath("prompts/shared/schemas/review-queue-projection.schema.json");
  const visualInputBundleSchema = resolveRepoPath("prompts/shared/schemas/visual-input-bundle.schema.json");
  const groundingSnapshotSchema = resolveRepoPath("prompts/shared/schemas/grounding-snapshot.schema.json");
  const solutionSnapshotSchema = resolveRepoPath("prompts/shared/schemas/solution-snapshot.schema.json");
  const consistencyReportSchema = resolveRepoPath("prompts/shared/schemas/consistency-report.schema.json");
  const rendererContractSchema = resolveRepoPath("prompts/shared/schemas/renderer-contract.schema.json");
  const visualEvidenceSchemas = [
    resolveRepoPath("prompts/shared/schemas/normalized-page.schema.json"),
    resolveRepoPath("prompts/shared/schemas/visual-region.schema.json"),
    problemEvidenceBundleSchema,
    trackResultSchema,
    decisionRecordSchema,
    visualRiskCaseInventorySchema,
    visualRiskDiagnosticReportSchema,
    deliveryQuestionCoverageSchema,
    deliveryDecisionAggregateSchema,
    deliveryDecisionAggregateAttachmentReceiptSchema,
    visualInputBundleSchema,
    groundingSnapshotSchema,
    solutionSnapshotSchema,
    consistencyReportSchema
  ];
  const subjectPackDirectories = listSubjectPackDirectories();
  const sampleRoot = resolveRepoPath("样例交付");
  const visualEvidenceRoot = resolveRepoPath("eval/visual-evidence/cases");
  const visualRiskFixtureRoot = path.join(visualEvidenceRoot, "visual-risk");
  const visualPreprocessingFixtureRoot = resolveRepoPath("eval/visual-preprocessing/cases");
  const visualPageNormalizationFixtureRoot = resolveRepoPath("eval/visual-page-normalization/cases");
  const visualRegionProposalFixtureRoot = resolveRepoPath("eval/visual-region-proposal/cases");
  const visualLocalCropFixtureRoot = resolveRepoPath("eval/visual-local-crops/cases");
  const visualRegionSemanticsFixtureRoot = resolveRepoPath("eval/visual-region-semantics/cases");
  const visualComponentSemanticsFixtureRoot = resolveRepoPath("eval/visual-component-semantics/cases");
  const visualStructureExtractionFixtureRoot = resolveRepoPath("eval/visual-structure-extraction/cases");
  const visualOcrObservationFixtureRoot = resolveRepoPath("eval/visual-ocr-observation/cases");
  const visualSpatialObservationFixtureRoot = resolveRepoPath("eval/visual-spatial-observation/cases");
  const visualOcrDiagnosticFixtureRoot = resolveRepoPath("eval/visual-ocr-diagnostics/cases");
  const visualTextRegionDiagnosticFixtureRoot = resolveRepoPath("eval/visual-text-region-diagnostics/cases");
  const visualMachineReviewFixtureRoot = resolveRepoPath("eval/visual-machine-review/cases");
  const visualOcrRegionAssociationFixtureRoot = resolveRepoPath("eval/visual-ocr-region-association/cases");
  const visualSemanticProjectionFixtureRoot = resolveRepoPath("eval/visual-semantic-projection/cases");
  const ocrLayoutSolverFixtureRoot = resolveRepoPath("eval/ocr-layout-solver/cases");
  const syntheticTrackValidatorFixtureRoot = resolveRepoPath("eval/synthetic-track-validator/cases");
  const rendererContractRoot = resolveRepoPath("eval/renderer-contract/cases");
  const sampleFlywheelEvalRoot = resolveRepoPath("eval/sample-flywheel/cases");
  const teacherFeedbackFixtureRoot = path.join(
    sampleFlywheelEvalRoot,
    "synthetic-teacher-feedback");
  const answerGenerationEvalRoot = resolveRepoPath("eval/answer-generation/cases");
  const figureSchemas = [
    resolveRepoPath("prompts/shared/schemas/problem-figure-asset.schema.json"),
    resolveRepoPath("prompts/shared/schemas/figure-understanding-result.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-spec.schema.json"),
    resolveRepoPath("prompts/shared/schemas/answer-graphic-artifact.schema.json"),
    resolveRepoPath("prompts/shared/schemas/placed-answer-graphic.schema.json")
  ];
  const samplePackageFiles = listFilesByNameRecursive(path.join(sampleRoot, "structured"), "sample.json")
    .map((filePath) => ({ filePath, schemaPath: samplePackageSchema }));
  const sampleIndexFiles = fs.existsSync(path.join(sampleRoot, "index.json"))
    ? [{ filePath: path.join(sampleRoot, "index.json"), schemaPath: sampleIndexSchema }]
    : [];
  const sampleNegativeCandidateFiles = listFilesBySuffixRecursive(sampleRoot, ".negative-candidate.json")
    .map((filePath) => ({ filePath, schemaPath: negativeCandidateSchema }));
  const visualEvidenceFiles = [
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".problem-evidence-bundle.json")
      .map((filePath) => ({ filePath, schemaPath: problemEvidenceBundleSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".track-a.json")
      .map((filePath) => ({ filePath, schemaPath: trackResultSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".track-b.json")
      .map((filePath) => ({ filePath, schemaPath: trackResultSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".track-c.json")
      .map((filePath) => ({ filePath, schemaPath: trackResultSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".decision-record.json")
      .map((filePath) => ({ filePath, schemaPath: decisionRecordSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".delivery-question-coverage.json")
      .map((filePath) => ({ filePath, schemaPath: deliveryQuestionCoverageSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".delivery-decision-aggregate.json")
      .map((filePath) => ({ filePath, schemaPath: deliveryDecisionAggregateSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".delivery-decision-aggregate-attachment-receipt.json")
      .map((filePath) => ({ filePath, schemaPath: deliveryDecisionAggregateAttachmentReceiptSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".visual-input-bundle.json")
      .map((filePath) => ({ filePath, schemaPath: visualInputBundleSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".grounding-snapshot.json")
      .map((filePath) => ({ filePath, schemaPath: groundingSnapshotSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".solution-snapshot.json")
      .map((filePath) => ({ filePath, schemaPath: solutionSnapshotSchema })),
    ...listFilesBySuffixRecursive(visualEvidenceRoot, ".consistency-report.json")
      .map((filePath) => ({ filePath, schemaPath: consistencyReportSchema }))
  ];
  const visualRiskCaseInventoryFiles = [{
    filePath: path.join(visualRiskFixtureRoot, "visual-risk-case-inventory.json"),
    schemaPath: visualRiskCaseInventorySchema
  }];
  const visualRiskDiagnosticReportFiles = [{
    filePath: path.join(visualRiskFixtureRoot, "visual-risk-diagnostic-report.json"),
    schemaPath: visualRiskDiagnosticReportSchema
  }];
  const visualPreprocessingRequestFiles = listFilesBySuffixRecursive(
    visualPreprocessingFixtureRoot,
    ".visual-preprocessing-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualPreprocessingRequestSchema }));
  const visualPreprocessingResultFiles = listFilesBySuffixRecursive(
    visualPreprocessingFixtureRoot,
    ".visual-preprocessing-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualPreprocessingResultSchema }));
  const visualPreprocessingCaseInventoryFiles = [{
    filePath: path.join(
      visualPreprocessingFixtureRoot,
      "visual-preprocessing-case-inventory.json"),
    schemaPath: visualPreprocessingCaseInventorySchema
  }];
  const visualStructureExtractionRequestFiles = listFilesBySuffixRecursive(
    visualStructureExtractionFixtureRoot,
    ".visual-structure-extraction-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualStructureExtractionRequestSchema }));
  const visualStructureExtractionResultFiles = listFilesBySuffixRecursive(
    visualStructureExtractionFixtureRoot,
    ".visual-structure-extraction-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualStructureExtractionResultSchema }));
  const visualStructureExtractionCaseInventoryFiles = [{
    filePath: path.join(
      visualStructureExtractionFixtureRoot,
      "visual-structure-extraction-case-inventory.json"),
    schemaPath: visualStructureExtractionCaseInventorySchema
  }];
  const visualOcrObservationRequestFiles = listFilesBySuffixRecursive(
    visualOcrObservationFixtureRoot,
    ".visual-ocr-observation-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualOcrObservationRequestSchema }));
  const visualOcrObservationResultFiles = listFilesBySuffixRecursive(
    visualOcrObservationFixtureRoot,
    ".visual-ocr-observation-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualOcrObservationResultSchema }));
  const visualOcrObservationCaseInventoryFiles = [{
    filePath: path.join(
      visualOcrObservationFixtureRoot,
      "visual-ocr-observation-case-inventory.json"),
    schemaPath: visualOcrObservationCaseInventorySchema
  }];
  const visualSpatialObservationRequestFiles = listFilesBySuffixRecursive(
    visualSpatialObservationFixtureRoot,
    ".visual-spatial-observation-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualSpatialObservationRequestSchema }));
  const visualSpatialObservationResultFiles = listFilesBySuffixRecursive(
    visualSpatialObservationFixtureRoot,
    ".visual-spatial-observation-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualSpatialObservationResultSchema }));
  const visualSpatialObservationCaseInventoryFiles = [{
    filePath: path.join(
      visualSpatialObservationFixtureRoot,
      "visual-spatial-observation-case-inventory.json"),
    schemaPath: visualSpatialObservationCaseInventorySchema
  }];
  const visualSyntheticTextTruthFiles = listFilesBySuffixRecursive(
    visualOcrDiagnosticFixtureRoot,
    ".visual-synthetic-text-truth.json")
    .map((filePath) => ({ filePath, schemaPath: visualSyntheticTextTruthSchema }));
  const visualOcrDiagnosticCaseInventoryFiles = [{
    filePath: path.join(
      visualOcrDiagnosticFixtureRoot,
      "visual-ocr-diagnostic-case-inventory.json"),
    schemaPath: visualOcrDiagnosticCaseInventorySchema
  }];
  const visualOcrDiagnosticReportFiles = [{
    filePath: path.join(visualOcrDiagnosticFixtureRoot, "visual-ocr-diagnostic-report.json"),
    schemaPath: visualOcrDiagnosticReportSchema
  }];
  const visualTextRegionDiagnosticCaseInventoryFiles = [{
    filePath: path.join(
      visualTextRegionDiagnosticFixtureRoot,
      "visual-text-region-diagnostic-case-inventory.json"),
    schemaPath: visualTextRegionDiagnosticCaseInventorySchema
  }];
  const visualTextRegionDiagnosticReportFiles = [{
    filePath: path.join(
      visualTextRegionDiagnosticFixtureRoot,
      "visual-text-region-diagnostic-report.json"),
    schemaPath: visualTextRegionDiagnosticReportSchema
  }];
  const visualMachineReviewReceiptFiles = listFilesBySuffixRecursive(
    visualMachineReviewFixtureRoot,
    ".visual-machine-review-receipt.json")
    .map((filePath) => ({ filePath, schemaPath: visualMachineReviewReceiptSchema }));
  const visualMachineReviewCaseInventoryFiles = [{
    filePath: path.join(
      visualMachineReviewFixtureRoot,
      "visual-machine-review-case-inventory.json"),
    schemaPath: visualMachineReviewCaseInventorySchema
  }];
  const visualMachineReviewReportFiles = [{
    filePath: path.join(visualMachineReviewFixtureRoot, "visual-machine-review-report.json"),
    schemaPath: visualMachineReviewReportSchema
  }];
  const visualOcrRegionAssociationRequestFiles = listFilesBySuffixRecursive(
    visualOcrRegionAssociationFixtureRoot,
    ".visual-ocr-region-association-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualOcrRegionAssociationRequestSchema }));
  const visualOcrRegionAssociationResultFiles = listFilesBySuffixRecursive(
    visualOcrRegionAssociationFixtureRoot,
    ".visual-ocr-region-association-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualOcrRegionAssociationResultSchema }));
  const visualOcrRegionAssociationCaseInventoryFiles = [{
    filePath: path.join(
      visualOcrRegionAssociationFixtureRoot,
      "visual-ocr-region-association-case-inventory.json"),
    schemaPath: visualOcrRegionAssociationCaseInventorySchema
  }];
  const visualOcrRegionAssociationReportFiles = [{
    filePath: path.join(
      visualOcrRegionAssociationFixtureRoot,
      "visual-ocr-region-association-report.json"),
    schemaPath: visualOcrRegionAssociationReportSchema
  }];
  const visualSyntheticSemanticDeclarationFiles = listFilesBySuffixRecursive(
    visualSemanticProjectionFixtureRoot,
    ".visual-synthetic-semantic-declaration.json")
    .map((filePath) => ({ filePath, schemaPath: visualSyntheticSemanticDeclarationSchema }));
  const visualSemanticProjectionRequestFiles = listFilesBySuffixRecursive(
    visualSemanticProjectionFixtureRoot,
    ".visual-semantic-projection-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualSemanticProjectionRequestSchema }));
  const visualSemanticProjectionResultFiles = listFilesBySuffixRecursive(
    visualSemanticProjectionFixtureRoot,
    ".visual-semantic-projection-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualSemanticProjectionResultSchema }));
  const visualSemanticProjectionCaseInventoryFiles = [{
    filePath: path.join(
      visualSemanticProjectionFixtureRoot,
      "visual-semantic-projection-case-inventory.json"),
    schemaPath: visualSemanticProjectionCaseInventorySchema
  }];
  const visualSemanticProjectionReportFiles = [{
    filePath: path.join(
      visualSemanticProjectionFixtureRoot,
      "visual-semantic-projection-report.json"),
    schemaPath: visualSemanticProjectionReportSchema
  }];
  const visualPageNormalizationRequestFiles = listFilesBySuffixRecursive(
    visualPageNormalizationFixtureRoot,
    ".visual-page-normalization-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualPageNormalizationRequestSchema }));
  const visualPageNormalizationResultFiles = listFilesBySuffixRecursive(
    visualPageNormalizationFixtureRoot,
    ".visual-page-normalization-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualPageNormalizationResultSchema }));
  const visualRegionProposalRequestFiles = listFilesBySuffixRecursive(
    visualRegionProposalFixtureRoot,
    ".visual-region-proposal-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualRegionProposalRequestSchema }));
  const visualRegionProposalResultFiles = listFilesBySuffixRecursive(
    visualRegionProposalFixtureRoot,
    ".visual-region-proposal-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualRegionProposalResultSchema }));
  const visualLocalCropRequestFiles = listFilesBySuffixRecursive(visualLocalCropFixtureRoot, ".visual-local-crop-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualLocalCropRequestSchema }));
  const visualLocalCropResultFiles = listFilesBySuffixRecursive(visualLocalCropFixtureRoot, ".visual-local-crop-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualLocalCropResultSchema }));
  const visualSyntheticRegionSemanticsDeclarationFiles = listFilesBySuffixRecursive(
    visualRegionSemanticsFixtureRoot,
    ".visual-synthetic-region-semantics-declaration.json")
    .map((filePath) => ({ filePath, schemaPath: visualSyntheticRegionSemanticsDeclarationSchema }));
  const visualRegionSemanticsRequestFiles = listFilesBySuffixRecursive(
    visualRegionSemanticsFixtureRoot,
    ".visual-region-semantics-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualRegionSemanticsRequestSchema }));
  const visualRegionSemanticsResultFiles = listFilesBySuffixRecursive(
    visualRegionSemanticsFixtureRoot,
    ".visual-region-semantics-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualRegionSemanticsResultSchema }));
  const visualSyntheticComponentSemanticsDeclarationFiles = listFilesBySuffixRecursive(
    visualComponentSemanticsFixtureRoot, ".visual-synthetic-component-semantics-declaration.json")
    .map((filePath) => ({ filePath, schemaPath: visualSyntheticComponentSemanticsDeclarationSchema }));
  const visualComponentSemanticsRequestFiles = listFilesBySuffixRecursive(
    visualComponentSemanticsFixtureRoot, ".visual-component-semantics-request.json")
    .map((filePath) => ({ filePath, schemaPath: visualComponentSemanticsRequestSchema }));
  const visualComponentSemanticsResultFiles = listFilesBySuffixRecursive(
    visualComponentSemanticsFixtureRoot, ".visual-component-semantics-result.json")
    .map((filePath) => ({ filePath, schemaPath: visualComponentSemanticsResultSchema }));
  const visualSyntheticQuestionFiles = listFilesBySuffixRecursive(
    ocrLayoutSolverFixtureRoot,
    ".visual-synthetic-question.json")
    .map((filePath) => ({ filePath, schemaPath: visualSyntheticQuestionSchema }));
  const ocrLayoutSolverRequestFiles = listFilesBySuffixRecursive(
    ocrLayoutSolverFixtureRoot,
    ".ocr-layout-solver-request.json")
    .map((filePath) => ({ filePath, schemaPath: ocrLayoutSolverRequestSchema }));
  const ocrLayoutSolverEvidenceBundleFiles = listFilesBySuffixRecursive(
    ocrLayoutSolverFixtureRoot,
    ".problem-evidence-bundle.json")
    .map((filePath) => ({ filePath, schemaPath: problemEvidenceBundleSchema }));
  const ocrLayoutSolverTrackResultFiles = listFilesBySuffixRecursive(
    ocrLayoutSolverFixtureRoot,
    ".track-b.json")
    .map((filePath) => ({ filePath, schemaPath: trackResultSchema }));
  const syntheticTrackValidatorRequestFiles = listFilesBySuffixRecursive(
    syntheticTrackValidatorFixtureRoot,
    ".synthetic-track-validator-request.json")
    .map((filePath) => ({ filePath, schemaPath: syntheticTrackValidatorRequestSchema }));
  const syntheticTrackValidatorConsistencyReportFiles = listFilesBySuffixRecursive(
    syntheticTrackValidatorFixtureRoot,
    ".consistency-report.json")
    .map((filePath) => ({ filePath, schemaPath: consistencyReportSchema }));
  const syntheticTrackValidatorTrackResultFiles = listFilesBySuffixRecursive(
    syntheticTrackValidatorFixtureRoot,
    ".track-c.json")
    .map((filePath) => ({ filePath, schemaPath: trackResultSchema }));
  const rendererContractFiles = listFilesBySuffixRecursive(rendererContractRoot, ".renderer-contract.json")
    .map((filePath) => ({ filePath, schemaPath: rendererContractSchema }));
  const optimizationReadinessInputFiles = listFilesByNameRecursive(
    sampleFlywheelEvalRoot,
    "readiness-input.json")
    .map((filePath) => ({ filePath, schemaPath: optimizationReadinessInputSchema }));
  const optimizationReadinessCaseInventoryFiles = listFilesByNameRecursive(
    sampleFlywheelEvalRoot,
    "readiness-case-inventory.json")
    .map((filePath) => ({ filePath, schemaPath: optimizationReadinessCaseInventorySchema }));
  const optimizationReadinessReportFiles = listFilesByNameRecursive(
    sampleFlywheelEvalRoot,
    "readiness-report.json")
    .map((filePath) => ({ filePath, schemaPath: optimizationReadinessReportSchema }));
  const teacherFeedbackSubmissionFiles = listFilesBySuffixRecursive(
    teacherFeedbackFixtureRoot,
    ".teacher-feedback-submission.json")
    .map((filePath) => ({ filePath, schemaPath: teacherFeedbackSubmissionSchema }));
  const teacherFeedbackParseResultFiles = listFilesBySuffixRecursive(
    teacherFeedbackFixtureRoot,
    ".feedback-parse-result.json")
    .map((filePath) => ({ filePath, schemaPath: feedbackParseResultSchema }));
  const teacherFeedbackFixtureInventoryFiles = fs.existsSync(path.join(
    teacherFeedbackFixtureRoot,
    "teacher-feedback-fixture-inventory.json"))
    ? [{
        filePath: path.join(
          teacherFeedbackFixtureRoot,
          "teacher-feedback-fixture-inventory.json"),
        schemaPath: teacherFeedbackFixtureInventorySchema
      }]
    : [];
  const teacherFeedbackDiagnosticReportFiles = [{
    filePath: path.join(
      teacherFeedbackFixtureRoot,
      "teacher-feedback-diagnostic-report.json"),
    schemaPath: teacherFeedbackDiagnosticReportSchema
  }];
  const teacherFeedbackReplayDiagnosticReportFiles = [{
    filePath: path.join(
      teacherFeedbackFixtureRoot,
      "teacher-feedback-replay-diagnostic-report.json"),
    schemaPath: teacherFeedbackReplayDiagnosticReportSchema
  }];
  const answerGenerationRequestFiles = listFilesBySuffixRecursive(
    answerGenerationEvalRoot,
    ".answer-generation-request.json")
    .map((filePath) => ({ filePath, schemaPath: answerGenerationRequestSchema }));
  const answerGenerationResultFiles = listFilesBySuffixRecursive(
    sampleRoot,
    ".answer-generation-result.json")
    .map((filePath) => ({ filePath, schemaPath: answerGenerationResultSchema }));

  return {
    manifests: [
      resolveRepoPath("prompts/platform-core/manifest.json"),
      ...subjectPackDirectories.map((directoryPath) => path.join(directoryPath, "manifest.json"))
    ].map((filePath) => ({ filePath, schemaPath: manifestSchema })),
    runtimeConfigs: subjectPackDirectories.map((directoryPath) => path.join(directoryPath, "config.json")).map((filePath) => ({ filePath, schemaPath: runtimeConfigSchema })),
    rulePacks: [
      ...listJsonFiles(resolveRepoPath("prompts/platform-core/rules")),
      ...subjectPackDirectories.flatMap((directoryPath) => listJsonFiles(path.join(directoryPath, "rules")))
    ].map((filePath) => ({ filePath, schemaPath: rulePackSchema })),
    profiles: [
      ...listJsonFiles(resolveRepoPath("prompts/platform-core/profiles")),
      ...subjectPackDirectories.flatMap((directoryPath) => listJsonFiles(path.join(directoryPath, "profiles")))
    ].map((filePath) => ({ filePath, schemaPath: profileSchema })),
    samplePackages: samplePackageFiles,
    sampleIndices: sampleIndexFiles,
    sampleNegativeCandidates: sampleNegativeCandidateFiles,
    answerGenerationRequests: answerGenerationRequestFiles,
    answerGenerationResults: answerGenerationResultFiles,
    optimizationReadinessCaseInventories: optimizationReadinessCaseInventoryFiles,
    optimizationReadinessInputs: optimizationReadinessInputFiles,
    optimizationReadinessReports: optimizationReadinessReportFiles,
    teacherFeedbackSubmissions: teacherFeedbackSubmissionFiles,
    teacherFeedbackParseResults: teacherFeedbackParseResultFiles,
    teacherFeedbackFixtureInventories: teacherFeedbackFixtureInventoryFiles,
    teacherFeedbackDiagnosticReports: teacherFeedbackDiagnosticReportFiles,
    teacherFeedbackReplayDiagnosticReports: teacherFeedbackReplayDiagnosticReportFiles,
    visualRiskCaseInventories: visualRiskCaseInventoryFiles,
    visualRiskDiagnosticReports: visualRiskDiagnosticReportFiles,
    visualPreprocessingRequests: visualPreprocessingRequestFiles,
    visualPreprocessingResults: visualPreprocessingResultFiles,
    visualPreprocessingCaseInventories: visualPreprocessingCaseInventoryFiles,
    visualPageNormalizationRequests: visualPageNormalizationRequestFiles,
    visualPageNormalizationResults: visualPageNormalizationResultFiles,
    visualRegionProposalRequests: visualRegionProposalRequestFiles,
    visualRegionProposalResults: visualRegionProposalResultFiles,
    visualLocalCropRequests: visualLocalCropRequestFiles,
    visualLocalCropResults: visualLocalCropResultFiles,
    visualSyntheticRegionSemanticsDeclarations: visualSyntheticRegionSemanticsDeclarationFiles,
    visualRegionSemanticsRequests: visualRegionSemanticsRequestFiles,
    visualRegionSemanticsResults: visualRegionSemanticsResultFiles,
    visualSyntheticComponentSemanticsDeclarations: visualSyntheticComponentSemanticsDeclarationFiles,
    visualComponentSemanticsRequests: visualComponentSemanticsRequestFiles,
    visualComponentSemanticsResults: visualComponentSemanticsResultFiles,
    visualStructureExtractionRequests: visualStructureExtractionRequestFiles,
    visualStructureExtractionResults: visualStructureExtractionResultFiles,
    visualStructureExtractionCaseInventories: visualStructureExtractionCaseInventoryFiles,
    visualOcrObservationRequests: visualOcrObservationRequestFiles,
    visualOcrObservationResults: visualOcrObservationResultFiles,
    visualOcrObservationCaseInventories: visualOcrObservationCaseInventoryFiles,
    visualSpatialObservationRequests: visualSpatialObservationRequestFiles,
    visualSpatialObservationResults: visualSpatialObservationResultFiles,
    visualSpatialObservationCaseInventories: visualSpatialObservationCaseInventoryFiles,
    visualSyntheticTextTruths: visualSyntheticTextTruthFiles,
    visualOcrDiagnosticCaseInventories: visualOcrDiagnosticCaseInventoryFiles,
    visualOcrDiagnosticReports: visualOcrDiagnosticReportFiles,
    visualTextRegionDiagnosticCaseInventories: visualTextRegionDiagnosticCaseInventoryFiles,
    visualTextRegionDiagnosticReports: visualTextRegionDiagnosticReportFiles,
    visualMachineReviewReceipts: visualMachineReviewReceiptFiles,
    visualMachineReviewCaseInventories: visualMachineReviewCaseInventoryFiles,
    visualMachineReviewReports: visualMachineReviewReportFiles,
    visualOcrRegionAssociationRequests: visualOcrRegionAssociationRequestFiles,
    visualOcrRegionAssociationResults: visualOcrRegionAssociationResultFiles,
    visualOcrRegionAssociationCaseInventories: visualOcrRegionAssociationCaseInventoryFiles,
    visualOcrRegionAssociationReports: visualOcrRegionAssociationReportFiles,
    visualSyntheticSemanticDeclarations: visualSyntheticSemanticDeclarationFiles,
    visualSemanticProjectionRequests: visualSemanticProjectionRequestFiles,
    visualSemanticProjectionResults: visualSemanticProjectionResultFiles,
    visualSemanticProjectionCaseInventories: visualSemanticProjectionCaseInventoryFiles,
    visualSemanticProjectionReports: visualSemanticProjectionReportFiles,
    visualSyntheticQuestions: visualSyntheticQuestionFiles,
    ocrLayoutSolverRequests: ocrLayoutSolverRequestFiles,
    ocrLayoutSolverEvidenceBundles: ocrLayoutSolverEvidenceBundleFiles,
    ocrLayoutSolverTrackResults: ocrLayoutSolverTrackResultFiles,
    syntheticTrackValidatorRequests: syntheticTrackValidatorRequestFiles,
    syntheticTrackValidatorConsistencyReports: syntheticTrackValidatorConsistencyReportFiles,
    syntheticTrackValidatorTrackResults: syntheticTrackValidatorTrackResultFiles,
    visualEvidenceFiles,
    rendererContractFiles,
    subjectPacks: subjectPackDirectories.map((directoryPath) => path.basename(directoryPath)),
    schemaFiles: [
      dataClassificationSchema,
      manifestSchema,
      runtimeConfigSchema,
      rulePackSchema,
      profileSchema,
      snapshotSchema,
      deliveryManifestSchema,
      reviewStateMachineSchema,
      feedbackRecordSchema,
      feedbackParseResultSchema,
      teacherFeedbackSubmissionSchema,
      teacherFeedbackFixtureInventorySchema,
      teacherFeedbackDiagnosticReportSchema,
      teacherFeedbackReplayDiagnosticReportSchema,
      answerGenerationRequestSchema,
      answerGenerationResultSchema,
      samplePackageSchema,
      sampleIndexSchema,
      negativeCandidateSchema,
      releaseQualificationSchema,
      sampleRunRecordSchema,
      optimizationReadinessCaseInventorySchema,
      optimizationReadinessInputSchema,
      optimizationReadinessReportSchema,
      readinessControlReceiptSchema,
      reviewQueueProjectionSchema,
      visualPreprocessingRequestSchema,
      visualPreprocessingResultSchema,
      visualPreprocessingCaseInventorySchema,
      visualPageNormalizationRequestSchema,
      visualPageNormalizationResultSchema,
      visualRegionProposalRequestSchema,
      visualRegionProposalResultSchema,
      visualLocalCropRequestSchema,
      visualLocalCropResultSchema,
      visualSyntheticRegionSemanticsDeclarationSchema,
      visualRegionSemanticsRequestSchema,
      visualRegionSemanticsResultSchema,
      visualSyntheticComponentSemanticsDeclarationSchema,
      visualComponentSemanticsRequestSchema,
      visualComponentSemanticsResultSchema,
      visualStructureExtractionRequestSchema,
      visualStructureExtractionResultSchema,
      visualStructureExtractionCaseInventorySchema,
      visualOcrObservationRequestSchema,
      visualOcrObservationResultSchema,
      visualOcrObservationCaseInventorySchema,
      visualSpatialObservationRequestSchema,
      visualSpatialObservationResultSchema,
      visualSpatialObservationCaseInventorySchema,
      visualSyntheticTextTruthSchema,
      visualOcrDiagnosticCaseInventorySchema,
      visualOcrDiagnosticReportSchema,
      visualTextRegionDiagnosticCaseInventorySchema,
      visualTextRegionDiagnosticReportSchema,
      visualMachineReviewReceiptSchema,
      visualMachineReviewCaseInventorySchema,
      visualMachineReviewReportSchema,
      visualOcrRegionAssociationRequestSchema,
      visualOcrRegionAssociationResultSchema,
      visualOcrRegionAssociationCaseInventorySchema,
      visualOcrRegionAssociationReportSchema,
      visualSyntheticSemanticDeclarationSchema,
      visualSemanticProjectionRequestSchema,
      visualSemanticProjectionResultSchema,
      visualSemanticProjectionCaseInventorySchema,
      visualSemanticProjectionReportSchema,
      visualSyntheticQuestionSchema,
      ocrLayoutSolverRequestSchema,
      syntheticTrackValidatorRequestSchema,
      ...visualEvidenceSchemas,
      rendererContractSchema,
      ...figureSchemas
    ],
    snapshotSchema,
    deliveryManifestSchema,
    figureSchemas
  };
}

function listSubjectPackDirectories() {
  const promptsRoot = resolveRepoPath("prompts");
  return fs
    .readdirSync(promptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(promptsRoot, entry.name))
    .filter((directoryPath) => fs.existsSync(path.join(directoryPath, "manifest.json")) && fs.existsSync(path.join(directoryPath, "config.json")));
}

function listFilesByNameRecursive(directoryPath, fileName) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesByNameRecursive(entryPath, fileName));
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      results.push(entryPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function listFilesBySuffixRecursive(directoryPath, fileNameSuffix) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesBySuffixRecursive(entryPath, fileNameSuffix));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(fileNameSuffix)) {
      results.push(entryPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function validateFiles(targets) {
  const errors = [];
  let validatedFileCount = 0;

  for (const group of [targets.manifests, targets.runtimeConfigs, targets.rulePacks, targets.profiles, targets.samplePackages, targets.sampleIndices, targets.sampleNegativeCandidates, targets.answerGenerationRequests, targets.answerGenerationResults, targets.optimizationReadinessCaseInventories, targets.optimizationReadinessInputs, targets.optimizationReadinessReports, targets.teacherFeedbackSubmissions, targets.teacherFeedbackParseResults, targets.teacherFeedbackFixtureInventories, targets.teacherFeedbackDiagnosticReports, targets.teacherFeedbackReplayDiagnosticReports, targets.visualRiskCaseInventories, targets.visualRiskDiagnosticReports, targets.visualPreprocessingRequests, targets.visualPreprocessingResults, targets.visualPreprocessingCaseInventories, targets.visualPageNormalizationRequests, targets.visualPageNormalizationResults, targets.visualRegionProposalRequests, targets.visualRegionProposalResults, targets.visualLocalCropRequests, targets.visualLocalCropResults, targets.visualSyntheticRegionSemanticsDeclarations, targets.visualRegionSemanticsRequests, targets.visualRegionSemanticsResults, targets.visualSyntheticComponentSemanticsDeclarations, targets.visualComponentSemanticsRequests, targets.visualComponentSemanticsResults, targets.visualStructureExtractionRequests, targets.visualStructureExtractionResults, targets.visualStructureExtractionCaseInventories, targets.visualOcrObservationRequests, targets.visualOcrObservationCaseInventories, targets.visualOcrObservationResults, targets.visualSpatialObservationRequests, targets.visualSpatialObservationResults, targets.visualSpatialObservationCaseInventories, targets.visualSyntheticTextTruths, targets.visualOcrDiagnosticCaseInventories, targets.visualOcrDiagnosticReports, targets.visualTextRegionDiagnosticCaseInventories, targets.visualTextRegionDiagnosticReports, targets.visualMachineReviewReceipts, targets.visualMachineReviewCaseInventories, targets.visualMachineReviewReports, targets.visualOcrRegionAssociationRequests, targets.visualOcrRegionAssociationResults, targets.visualOcrRegionAssociationCaseInventories, targets.visualOcrRegionAssociationReports, targets.visualSyntheticSemanticDeclarations, targets.visualSemanticProjectionRequests, targets.visualSemanticProjectionResults, targets.visualSemanticProjectionCaseInventories, targets.visualSemanticProjectionReports, targets.visualSyntheticQuestions, targets.ocrLayoutSolverRequests, targets.ocrLayoutSolverEvidenceBundles, targets.ocrLayoutSolverTrackResults, targets.syntheticTrackValidatorRequests, targets.syntheticTrackValidatorConsistencyReports, targets.syntheticTrackValidatorTrackResults, targets.visualEvidenceFiles, targets.rendererContractFiles]) {
    for (const target of group) {
      const fileErrors = validateJsonFileAgainstSchema(target.filePath, target.schemaPath);
      validatedFileCount += 1;
      for (const error of fileErrors) {
        errors.push(`${path.relative(resolveRepoPath("."), target.filePath)}: ${error}`);
      }
    }
  }

  return { errors, validatedFileCount };
}

function validateSchemaFiles(schemaFiles) {
  const errors = [];

  for (const schemaPath of schemaFiles) {
    errors.push(...validateSchemaFile(schemaPath));
  }

  return errors;
}

function validateSnapshots(snapshotSchema, subjectPacks) {
  return subjectPacks.map((subjectPack) => {
    const snapshot = compileResolvedSnapshot({ subjectPack });
    const errors = validateValueAgainstSchema(snapshot, snapshotSchema);
    return { subjectPack, snapshot, errors };
  });
}

function validateSchemaFile(schemaPath) {
  const schema = readJsonFile(schemaPath);
  const errors = [];

  if (schema.type !== "object") {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema root should declare object type.`);
  }

  if (typeof schema.$id !== "string" || schema.$id.trim().length === 0) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should declare a non-empty $id.`);
  }

  if (typeof schema.compatibility !== "object" || schema.compatibility === null) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should declare compatibility metadata.`);
  } else {
    if (typeof schema.compatibility.forward !== "string" || schema.compatibility.forward.trim().length === 0) {
      errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: compatibility.forward should be a non-empty string.`);
    }

    if (typeof schema.compatibility.backward !== "string" || schema.compatibility.backward.trim().length === 0) {
      errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: compatibility.backward should be a non-empty string.`);
    }
  }

  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    errors.push(`${path.relative(resolveRepoPath("."), schemaPath)}: schema should define required fields.`);
  }

  return errors;
}

function compareVersion(a, b) {
  const pa = a.split(".").map((value) => Number(value));
  const pb = b.split(".").map((value) => Number(value));
  const length = Math.max(pa.length, pb.length);
  for (let index = 0; index < length; index += 1) {
    const left = pa[index] ?? 0;
    const right = pb[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function validateAssemblyGeneratedArtifacts(subjectPackDirectories) {
  const assemblyRoot = resolveRepoPath("prompts/specs/assemblies");
  if (!fs.existsSync(assemblyRoot)) {
    return ["Missing assembly root: prompts/specs/assemblies"];
  }

  const assemblyFiles = fs
    .readdirSync(assemblyRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(assemblyRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const errors = [];
  const subjectPackByName = new Map(
    subjectPackDirectories.map((directoryPath) => [path.basename(directoryPath), directoryPath])
  );
  const assembliesBySubjectPack = new Map();
  const normalizeRelativePath = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return value;
    }

    return path.posix.normalize(value.replace(/\\/g, "/"));
  };

  for (const assemblyFile of assemblyFiles) {
    const assembly = readJsonFile(assemblyFile);
    const existingAssemblies = assembliesBySubjectPack.get(assembly.subjectPack) ?? [];
    existingAssemblies.push(assemblyFile);
    assembliesBySubjectPack.set(assembly.subjectPack, existingAssemblies);
    errors.push(...checkAssemblyOutputs(assemblyFile));

    const subjectPackDir = subjectPackByName.get(assembly.subjectPack);
    if (!subjectPackDir) {
      errors.push(`Assembly ${path.relative(resolveRepoPath("."), assemblyFile)} references missing subject-pack ${assembly.subjectPack}.`);
      continue;
    }

    const manifest = readJsonFile(path.join(subjectPackDir, "manifest.json"));
    const config = readJsonFile(path.join(subjectPackDir, "config.json"));
    const relativeHumanSpec = path.relative(subjectPackDir, path.resolve(path.dirname(assemblyFile), assembly.fullOutput)).replace(/\\/g, "/");
    const relativeSpecMirror = path.relative(subjectPackDir, path.resolve(path.dirname(assemblyFile), assembly.mirroredSpecOutput)).replace(/\\/g, "/");

    if (normalizeRelativePath(manifest.sourceOfTruth?.humanSpec) !== normalizeRelativePath(relativeHumanSpec)) {
      errors.push(`Manifest humanSpec ${manifest.sourceOfTruth?.humanSpec ?? "(missing)"} does not match assembly output ${relativeHumanSpec}.`);
    }

    if (normalizeRelativePath(config.sourceOfTruth?.humanSpec) !== normalizeRelativePath(relativeHumanSpec)) {
      errors.push(`Runtime config humanSpec ${config.sourceOfTruth?.humanSpec ?? "(missing)"} does not match assembly output ${relativeHumanSpec}.`);
    }

    if (normalizeRelativePath(manifest.sourceOfTruth?.mirroredSpec) !== normalizeRelativePath(relativeSpecMirror)) {
      errors.push(`Manifest mirroredSpec ${manifest.sourceOfTruth?.mirroredSpec ?? "(missing)"} does not match assembly mirror ${relativeSpecMirror}.`);
    }

    if (normalizeRelativePath(config.sourceOfTruth?.mirroredSpec) !== normalizeRelativePath(relativeSpecMirror)) {
      errors.push(`Runtime config mirroredSpec ${config.sourceOfTruth?.mirroredSpec ?? "(missing)"} does not match assembly mirror ${relativeSpecMirror}.`);
    }
  }

  for (const subjectPack of subjectPackByName.keys()) {
    const matchingAssemblies = assembliesBySubjectPack.get(subjectPack) ?? [];
    if (matchingAssemblies.length === 0) {
      errors.push(`Subject-pack ${subjectPack} is missing prompts/specs/assemblies coverage.`);
      continue;
    }

    if (matchingAssemblies.length > 1) {
      errors.push(
        `Subject-pack ${subjectPack} is referenced by multiple assemblies: ${matchingAssemblies.map((filePath) => path.relative(resolveRepoPath("."), filePath)).join(", ")}.`
      );
    }
  }

  return errors;
}

function validateOptimizationReadinessFixtures(inventories, inputs, reports) {
  const errors = [];
  const inventoryByDirectory = new Map(
    inventories.map((target) => [path.dirname(target.filePath), target.filePath]));
  const inputByDirectory = new Map(
    inputs.map((target) => [path.dirname(target.filePath), target.filePath]));
  const reportByDirectory = new Map(
    reports.map((target) => [path.dirname(target.filePath), target.filePath]));
  const directories = new Set([
    ...inventoryByDirectory.keys(),
    ...inputByDirectory.keys(),
    ...reportByDirectory.keys()
  ]);
  for (const directory of directories) {
    const inventoryPath = inventoryByDirectory.get(directory);
    const inputPath = inputByDirectory.get(directory);
    const reportPath = reportByDirectory.get(directory);
    const relativeDirectory = path.relative(resolveRepoPath("."), directory);
    if (!inventoryPath || !inputPath || !reportPath) {
      errors.push(
        `Optimization readiness fixture ${relativeDirectory} must contain exactly readiness-case-inventory.json, readiness-input.json, and readiness-report.json.`
      );
      continue;
    }
    try {
      const input = readJsonFile(inputPath);
      if (input.caseInventoryRef !== path.basename(inventoryPath)) {
        throw new Error(
          "readiness-input.json must reference its canonical sibling readiness-case-inventory.json.");
      }
      validateOptimizationReadinessReport(readJsonFile(reportPath), inputPath);
    } catch (error) {
      errors.push(
        `Optimization readiness fixture ${relativeDirectory}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return errors;
}

function validateVisualStructureExtractionBoundary(resultTargets) {
  const errors = [];
  const canonicalTarget = resultTargets[0];
  if (!canonicalTarget) {
    return ["Visual structure extraction boundary requires a canonical result fixture."];
  }

  const canonical = readJsonFile(canonicalTarget.filePath);
  const mutations = [
    ["remote provider", (value) => { value.engineProvenance.engineKind = "remote_provider"; }],
    ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
    ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, canonicalTarget.schemaPath).length === 0) {
      errors.push(`Visual structure extraction schema must reject ${label} provenance.`);
    }
  }
  return errors;
}

function validateVisualOcrObservationBoundary(resultTargets) {
  const errors = [];
  const canonicalTarget = resultTargets[0];
  if (!canonicalTarget) {
    return ["Visual OCR observation boundary requires a canonical result fixture."];
  }

  const canonical = readJsonFile(canonicalTarget.filePath);
  const mutations = [
    ["ground-truth authority", (value) => { value.dispositions.groundTruthAvailable = true; }],
    ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
    ["semantic inference", (value) => { value.dispositions.semanticDisposition = "inferred"; }],
    ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
    ["remote provider", (value) => { value.engineProvenance.engineKind = "remote_provider"; }],
    ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
    ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, canonicalTarget.schemaPath).length === 0) {
      errors.push(`Visual OCR observation schema must reject ${label}.`);
    }
  }
  return errors;
}

function validateVisualSpatialObservationBoundary(resultTargets) {
  const errors = [];
  const canonicalTarget = resultTargets[0];
  if (!canonicalTarget) {
    return ["Visual spatial observation boundary requires a canonical result fixture."];
  }

  const canonical = readJsonFile(canonicalTarget.filePath);
  const mutations = [
    ["positive association", (value) => { value.dispositions.associationDisposition = "decided"; }],
    ["layout inference", (value) => { value.dispositions.layoutDisposition = "inferred"; }],
    ["semantic inference", (value) => { value.dispositions.semanticDisposition = "inferred"; }],
    ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
    ["remote provider", (value) => { value.engineProvenance.engineKind = "remote_provider"; }],
    ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
    ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, canonicalTarget.schemaPath).length === 0) {
      errors.push(`Visual spatial observation schema must reject ${label}.`);
    }
  }
  return errors;
}

function validateVisualOcrDiagnosticBoundary(reportTargets) {
  const errors = [];
  const canonicalTarget = reportTargets[0];
  if (!canonicalTarget) {
    return ["Visual OCR diagnostic boundary requires a canonical report fixture."];
  }

  const canonical = readJsonFile(canonicalTarget.filePath);
  const mutations = [
    ["production diagnostic scope", (value) => { value.dispositions.diagnosticScope = "production"; }],
    ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
    ["human review bypass", (value) => { value.dispositions.requiresHumanReview = false; }],
    ["layout inference", (value) => { value.dispositions.layoutDisposition = "inferred"; }],
    ["semantic inference", (value) => { value.dispositions.semanticDisposition = "inferred"; }],
    ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
    ["remote provider", (value) => { value.engineProvenance.engineKind = "remote_provider"; }],
    ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
    ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }],
    ["unavailable ratio value", (value) => {
      value.caseReports[0].metrics.precision.value = 0;
    }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, canonicalTarget.schemaPath).length === 0) {
      errors.push(`Visual OCR diagnostic schema must reject ${label}.`);
    }
  }
  return errors;
}

function validateVisualTextRegionDiagnosticBoundary(reportTargets) {
  const errors = [];
  const canonicalTarget = reportTargets[0];
  if (!canonicalTarget) {
    return ["Visual text-region diagnostic boundary requires a canonical report fixture."];
  }

  const canonical = readJsonFile(canonicalTarget.filePath);
  const mutations = [
    ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
    ["human review bypass", (value) => { value.dispositions.requiresHumanReview = false; }],
    ["OCR inference", (value) => { value.dispositions.ocrDisposition = "recognized"; }],
    ["association decision", (value) => { value.dispositions.associationDisposition = "matched"; }],
    ["layout inference", (value) => { value.dispositions.layoutDisposition = "inferred"; }],
    ["semantic inference", (value) => { value.dispositions.semanticDisposition = "inferred"; }],
    ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
    ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
    ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }],
    ["unavailable ratio value", (value) => {
      value.caseReports[1].metrics.precision.value = 0;
    }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, canonicalTarget.schemaPath).length === 0) {
      errors.push(`Visual text-region diagnostic schema must reject ${label}.`);
    }
  }
  return errors;
}

function validateVisualMachineReviewBoundary(receiptTargets, reportTargets) {
  const errors = [];
  const canonicalReceiptTarget = receiptTargets[0];
  const canonicalReportTarget = reportTargets[0];
  if (!canonicalReceiptTarget) {
    errors.push("Visual machine review boundary requires a canonical receipt fixture.");
  } else {
    const canonicalReceipt = readJsonFile(canonicalReceiptTarget.filePath);
    const receiptMutations = [
      ["human reviewer kind", (value) => { value.reviewer.reviewerKind = "human"; }],
      ["human review claim", (value) => { value.reviewer.humanReviewed = true; }],
      ["human attestation", (value) => { value.reviewer.attestationClass = "human_attested"; }],
      ["production equivalence", (value) => { value.reviewPolicy.equivalencePolicy = "production_equivalent"; }],
      ["production acceptance scope", (value) => { value.reviewPolicy.acceptanceScope = "production"; }],
      ["delivery trust projection", (value) => { value.dispositions.deliveryTrustDisposition = "trusted"; }],
      ["WPF integration", (value) => { value.dispositions.wpfDisposition = "integrated"; }],
      ["live acceptance", (value) => { value.dispositions.liveAcceptanceDisposition = "accepted"; }],
      ["verified controls", (value) => { value.dispositions.controlsDisposition = "verified"; }],
      ["eligibility", (value) => { value.dispositions.eligible = true; }],
      ["live provider", (value) => { value.reviewer.liveProvider = true; }],
      ["cloud egress", (value) => { value.reviewer.cloudEgress = true; }]
    ];
    for (const [label, mutate] of receiptMutations) {
      const candidate = structuredClone(canonicalReceipt);
      mutate(candidate);
      if (validateValueAgainstSchema(candidate, canonicalReceiptTarget.schemaPath).length === 0) {
        errors.push(`Visual machine review receipt schema must reject ${label}.`);
      }
    }
  }

  if (!canonicalReportTarget) {
    errors.push("Visual machine review boundary requires a canonical report fixture.");
  } else {
    const canonicalReport = readJsonFile(canonicalReportTarget.filePath);
    const reportMutations = [
      ["production equivalence", (value) => { value.dispositions.equivalencePolicy = "production_equivalent"; }],
      ["production acceptance scope", (value) => { value.dispositions.acceptanceScope = "production"; }],
      ["human identity claim", (value) => { value.dispositions.humanIdentityDisposition = "claimed"; }],
      ["delivery trust projection", (value) => { value.dispositions.deliveryTrustDisposition = "trusted"; }],
      ["WPF integration", (value) => { value.dispositions.wpfDisposition = "integrated"; }],
      ["live acceptance", (value) => { value.dispositions.liveAcceptanceDisposition = "accepted"; }],
      ["verified controls", (value) => { value.dispositions.controlsDisposition = "verified"; }],
      ["eligibility", (value) => { value.dispositions.eligible = true; }],
      ["optimization candidate", (value) => { value.dispositions.optimizationCandidateRefs = ["forbidden"]; }],
      ["human-reviewed count", (value) => { value.totals.humanReviewedCount = 1; }],
      ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
    ];
    for (const [label, mutate] of reportMutations) {
      const candidate = structuredClone(canonicalReport);
      mutate(candidate);
      if (validateValueAgainstSchema(candidate, canonicalReportTarget.schemaPath).length === 0) {
        errors.push(`Visual machine review report schema must reject ${label}.`);
      }
    }
  }
  return errors;
}

function main() {
  const targets = collectValidationTargets();
  const fileValidation = validateFiles(targets);
  const snapshotValidations = validateSnapshots(targets.snapshotSchema, targets.subjectPacks);
  const assemblyErrors = validateAssemblyGeneratedArtifacts(targets.subjectPacks.map((subjectPack) => resolveRepoPath(`prompts/${subjectPack}`)));
  const schemaFileErrors = validateSchemaFiles(targets.schemaFiles);
  const optimizationReadinessErrors = validateOptimizationReadinessFixtures(
    targets.optimizationReadinessCaseInventories,
    targets.optimizationReadinessInputs,
    targets.optimizationReadinessReports);
  const visualStructureExtractionBoundaryErrors =
    validateVisualStructureExtractionBoundary(targets.visualStructureExtractionResults);
  const visualOcrObservationBoundaryErrors =
    validateVisualOcrObservationBoundary(targets.visualOcrObservationResults);
  const visualSpatialObservationBoundaryErrors =
    validateVisualSpatialObservationBoundary(targets.visualSpatialObservationResults);
  const visualOcrDiagnosticBoundaryErrors =
    validateVisualOcrDiagnosticBoundary(targets.visualOcrDiagnosticReports);
  const visualTextRegionDiagnosticBoundaryErrors =
    validateVisualTextRegionDiagnosticBoundary(targets.visualTextRegionDiagnosticReports);
  const visualMachineReviewBoundaryErrors = validateVisualMachineReviewBoundary(
    targets.visualMachineReviewReceipts,
    targets.visualMachineReviewReports);
  const visualOcrRegionAssociationBoundaryErrors =
    validateVisualOcrRegionAssociationBoundary(
      targets.visualOcrRegionAssociationResults,
      targets.visualOcrRegionAssociationReports);
  const visualRegionSemanticsBoundaryErrors = validateVisualRegionSemanticsBoundary(
    targets.visualSyntheticRegionSemanticsDeclarations,
    targets.visualRegionSemanticsRequests,
    targets.visualRegionSemanticsResults);
  const visualComponentSemanticsBoundaryErrors = validateVisualComponentSemanticsBoundary(
    targets.visualSyntheticComponentSemanticsDeclarations,
    targets.visualComponentSemanticsRequests,
    targets.visualComponentSemanticsResults);
  const visualSemanticProjectionBoundaryErrors =
    validateVisualSemanticProjectionBoundary(
      targets.visualSyntheticSemanticDeclarations,
      targets.visualSemanticProjectionRequests,
      targets.visualSemanticProjectionResults,
      targets.visualSemanticProjectionCaseInventories,
      targets.visualSemanticProjectionReports);
  const mergedAssetValidations = targets.subjectPacks.map((subjectPack) => ({
    subjectPack,
    mergedAssets: buildMergedAssets({ subjectPack })
  }));
  let sampleAuthorityError;
  try {
    validateCanonicalSampleAuthorities();
  } catch (error) {
    sampleAuthorityError = error instanceof Error ? error.message : String(error);
  }
  let answerGenerationFixtureError;
  try {
    validateCanonicalSyntheticGenerationFixtures();
  } catch (error) {
    answerGenerationFixtureError = error instanceof Error ? error.message : String(error);
  }
  let teacherFeedbackFixtureError;
  try {
    validateCanonicalTeacherFeedbackFixtures();
  } catch (error) {
    teacherFeedbackFixtureError = error instanceof Error ? error.message : String(error);
  }
  let teacherFeedbackDiagnosticReportError;
  try {
    const reportPath = targets.teacherFeedbackDiagnosticReports[0].filePath;
    validateTeacherFeedbackDiagnosticReport(readJsonFile(reportPath));
  } catch (error) {
    teacherFeedbackDiagnosticReportError = error instanceof Error
      ? error.message
      : String(error);
  }
  let teacherFeedbackReplayDiagnosticReportError;
  try {
    const reportPath = targets.teacherFeedbackReplayDiagnosticReports[0].filePath;
    const report = validateTeacherFeedbackReplayDiagnosticReport(
      readJsonFile(reportPath));
    if (report.totals.failedCount !== 0 || report.totals.passRate !== 1) {
      throw new Error(
        "Canonical teacher feedback replay report must have zero failures and passRate=1.");
    }
  } catch (error) {
    teacherFeedbackReplayDiagnosticReportError = error instanceof Error
      ? error.message
      : String(error);
  }
  let visualRiskDiagnosticReportError;
  try {
    const reportPath = targets.visualRiskDiagnosticReports[0].filePath;
    const report = validateVisualRiskDiagnosticReport(readJsonFile(reportPath));
    if (report.subjectReports.some((subjectReport) =>
      subjectReport.falseReleaseRate !== 0
      || subjectReport.correctFlagRecall !== 1
      || subjectReport.bindingAccuracy !== 1
      || subjectReport.replayPassRate !== 1)) {
      throw new Error(
        "Canonical visual risk report must pass all per-subject diagnostic thresholds.");
    }
  } catch (error) {
    visualRiskDiagnosticReportError = error instanceof Error
      ? error.message
      : String(error);
  }

  const errors = [
    ...fileValidation.errors,
    ...snapshotValidations.flatMap((validation) =>
      validation.errors.map((error) => `ResolvedSnapshot(${validation.subjectPack}): ${error}`)
    ),
    ...assemblyErrors,
    ...schemaFileErrors,
    ...optimizationReadinessErrors,
    ...visualStructureExtractionBoundaryErrors,
    ...visualOcrObservationBoundaryErrors,
    ...visualSpatialObservationBoundaryErrors,
    ...visualOcrDiagnosticBoundaryErrors,
    ...visualTextRegionDiagnosticBoundaryErrors,
    ...visualMachineReviewBoundaryErrors,
    ...visualOcrRegionAssociationBoundaryErrors,
    ...visualRegionSemanticsBoundaryErrors,
    ...visualComponentSemanticsBoundaryErrors,
    ...visualSemanticProjectionBoundaryErrors,
    ...(teacherFeedbackFixtureError
      ? [`Canonical teacher feedback fixtures: ${teacherFeedbackFixtureError}`]
      : []),
    ...(teacherFeedbackDiagnosticReportError
      ? [`Canonical teacher feedback diagnostic report: ${teacherFeedbackDiagnosticReportError}`]
      : []),
    ...(teacherFeedbackReplayDiagnosticReportError
      ? [`Canonical teacher feedback replay diagnostic report: ${teacherFeedbackReplayDiagnosticReportError}`]
      : []),
    ...(visualRiskDiagnosticReportError
      ? [`Canonical visual risk diagnostic report: ${visualRiskDiagnosticReportError}`]
      : []),
    ...(sampleAuthorityError ? [`Canonical sample authority: ${sampleAuthorityError}`] : []),
    ...(answerGenerationFixtureError
      ? [`Canonical answer generation fixtures: ${answerGenerationFixtureError}`]
      : [])
  ];

  for (const validation of mergedAssetValidations) {
    if (!validation.mergedAssets.rules.length) {
      errors.push(`Merged assets produced zero rules for ${validation.subjectPack}.`);
    }

    if (!Object.keys(validation.mergedAssets.profiles).length) {
      errors.push(`Merged assets produced zero profiles for ${validation.subjectPack}.`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Validated ${fileValidation.validatedFileCount} asset files, ${mergedAssetValidations.length} subject packs, and ${snapshotValidations.length} snapshots (${snapshotValidations.map((validation) => `${validation.subjectPack}:${validation.snapshot.snapshotId}`).join(", ")}).`
  );
}

main();
