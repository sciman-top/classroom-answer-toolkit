import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const canonicalRoot = path.join(repoRoot, "eval", "ocr-layout-solver", "cases");
const projectionPath = path.join(
  repoRoot,
  "eval",
  "visual-semantic-projection",
  "cases",
  "junior-readable-measurement.visual-semantic-projection-result.json"
);
const questionSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "visual-synthetic-question.schema.json");
const evidenceBundleSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "problem-evidence-bundle.schema.json");
const requestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "ocr-layout-solver-request.schema.json");
const trackResultSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "track-result.schema.json");
const canonicalGeneratedAt = Object.freeze({
  question: "2026-07-30T00:00:00Z",
  evidenceBundle: "2026-07-30T00:00:01Z",
  request: "2026-07-30T00:00:02Z",
  trackResult: "2026-07-30T00:00:03Z"
});

const SOLVER_POLICY = Object.freeze({
  questionBinding: "exact_question_id_ref_and_authority_hash",
  valueSource: "bound_semantic_projection_recognized_text",
  numericGrammar: "ascii_decimal",
  unitSource: "explicit_question_text",
  semanticRole: "measurement_reading",
  ambiguityDisposition: "fail_closed",
  reviewDisposition: "always_review_synthetic_track_b"
});

export function stableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function solverPolicySha256() {
  return sha256(stableJsonBytes(SOLVER_POLICY));
}

export function buildProblemEvidenceBundle({
  question,
  questionBytes,
  projection,
  projectionBytes,
  generatedAt,
  references
}) {
  validateQuestionAuthority(question);
  const projected = validateProjectionAuthority(question, projection);
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(projection, projectionBytes, "semantic projection authority");

  const refs = artifactReferences(question, references);
  return {
    schemaVersion: "1.0",
    kind: "problem-evidence-bundle",
    evidenceBundleId: `veb-${question.caseId}-synthetic-track-b`,
    subjectPack: question.subjectPack,
    questionId: question.questionId,
    questionRef: question.questionRef,
    normalizedQuestionRef: `${question.subjectPack}:${question.questionId}`,
    figureRefs: [question.caseId],
    cropRefs: [question.figureBinding.cropRef],
    ocrRefs: [projected.ocrObservationRef ?? projected.projectionId],
    evidenceRefs: [question.figureBinding.cropRef, projected.projectionId],
    questionBinding: {
      status: "stable",
      questionAuthorityRef: refs.question,
      questionAuthoritySha256: sha256(questionBytes),
      reasons: ["explicit synthetic question authority is byte-bound"]
    },
    semanticEvidence: {
      projectionResultRef: refs.projection,
      projectionResultSha256: sha256(projectionBytes),
      projectionId: projected.projectionId,
      semanticRole: projected.semanticRole
    },
    binding: {
      status: "stable",
      confidence: 1,
      reasons: ["question, crop, and semantic projection share one synthetic case"]
    },
    risk: {
      level: "high",
      categories: ["instrument_reading"],
      reviewRequired: true,
      reasons: ["synthetic Track B result is diagnostic-only and requires review"]
    },
    provenance: {
      compilerVersion: "ocr-layout-solver-v1",
      sourceType: "synthetic_question_evidence_bundle",
      acceptanceTier: "repo_side_synthetic_diagnostic",
      sourceArtifactRefs: [
        refs.question,
        refs.projection
      ],
      liveProvider: false,
      egressPolicy: { allowCloud: false }
    },
    generatedAt: generatedAt ?? new Date().toISOString()
  };
}

export function buildSolverRequest({
  question,
  questionBytes,
  projection,
  projectionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  requestedAt,
  references
}) {
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(projection, projectionBytes, "semantic projection authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  validateCrossAuthorityBinding(question, projection, evidenceBundle, {
    questionBytes,
    projectionBytes
  });
  const projected = validateProjectionAuthority(question, projection);

  const refs = artifactReferences(question, references);
  return {
    schemaVersion: "1.0",
    kind: "ocr-layout-solver-request",
    requestId: `${question.caseId}-ocr-layout-solver`,
    subjectPack: question.subjectPack,
    fixtureKind: "synthetic_fixture",
    requestArtifactRef: refs.request,
    question: {
      artifactRef: refs.question,
      rawByteSha256: sha256(questionBytes),
      questionId: question.questionId,
      questionRef: question.questionRef
    },
    evidenceBundle: {
      artifactRef: refs.evidenceBundle,
      rawByteSha256: sha256(evidenceBundleBytes),
      evidenceBundleId: evidenceBundle.evidenceBundleId
    },
    semanticProjection: {
      artifactRef: refs.projection,
      rawByteSha256: sha256(projectionBytes),
      requestId: projection.requestId,
      projectionId: projected.projectionId
    },
    expectedInterpretation: {
      quantityKind: question.interpretationAuthority.quantityKind,
      semanticRole: question.interpretationAuthority.semanticRoleRequired,
      unitId: question.interpretationAuthority.unit.unitId,
      unitSymbol: question.interpretationAuthority.unit.symbol,
      numericGrammar: "ascii_decimal"
    },
    solverPolicySha256: solverPolicySha256(),
    dispositions: requestDispositions(),
    requestedAt: requestedAt ?? new Date().toISOString()
  };
}

export function compileTrackResult({
  question,
  questionBytes,
  projection,
  projectionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  request,
  generatedAt
}) {
  requireSnapshot(question, questionBytes, "question authority");
  validateQuestionAuthority(question);
  const projected = validateProjectionAuthority(question, projection);
  requireSnapshot(projection, projectionBytes, "semantic projection authority");
  validateCrossAuthorityBinding(question, projection, evidenceBundle, {
    questionBytes,
    projectionBytes
  });
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  validateRequestBindings({
    question,
    questionBytes,
    projection,
    projectionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    request,
    projected
  });

  const numericValue = normalizeNumericValue(projected.recognizedText);
  const unit = question.interpretationAuthority.unit;
  const answerCandidate = `${numericValue} ${unit.symbol}`;

  return {
    schemaVersion: "1.0",
    kind: "track-result",
    trackResultId: `track-b-${question.caseId}-synthetic`,
    evidenceBundleRef: evidenceBundle.evidenceBundleId,
    trackType: "ocr_layout_solver",
    candidateSourceType: "generated",
    answerCandidate,
    confidence: 1,
    visualDetailMode: "not_applicable",
    requestedVisualDetailMode: "not_applicable",
    providerVisualDetailMode: "not_applicable",
    stageArtifactRefs: {
      syntheticQuestionRef: request.question.artifactRef,
      semanticProjectionResultRef: request.semanticProjection.artifactRef,
      solverRequestRef: request.requestArtifactRef
    },
    questionBinding: {
      status: "exact",
      questionId: question.questionId,
      questionRef: question.questionRef,
      questionAuthoritySha256: sha256(questionBytes),
      evidenceBundleRef: evidenceBundle.evidenceBundleId
    },
    interpretation: {
      quantityKind: question.interpretationAuthority.quantityKind,
      numericValue,
      unitId: unit.unitId,
      unitSymbol: unit.symbol,
      semanticRole: projected.semanticRole,
      interpretationMode: "explicit_question_unit_plus_bound_ocr_numeric"
    },
    answerCandidateProvenance: {
      sourceType: "deterministic_synthetic_solver",
      sourceRequestSha256: sha256(stableJsonBytes(request)),
      questionAuthoritySha256: sha256(questionBytes),
      evidenceBundleSha256: sha256(evidenceBundleBytes),
      semanticProjectionSha256: sha256(projectionBytes),
      solverPolicySha256: solverPolicySha256()
    },
    solverProvenance: {
      engineKind: "deterministic_ocr_layout_solver",
      engineId: "ocr-layout-solver",
      engineVersion: "1.0.0",
      liveProvider: false,
      cloudEgress: false
    },
    visibleEvidenceSummary: "One public synthetic question binds an explicit unit to one VISION-016 measurement reading.",
    evidenceRefs: [question.figureBinding.cropRef, projected.projectionId],
    conflictRefs: [],
    missingEvidenceRefs: [],
    validatorFindings: [{
      findingId: "synthetic_track_b_requires_review",
      severity: "blocking",
      message: "Synthetic Track B output cannot be accepted without a separate review authority.",
      evidenceRef: evidenceBundle.evidenceBundleId
    }],
    risk: {
      level: "high",
      reviewRequired: true,
      reasons: ["synthetic_track_b_requires_review", "acceptance_tier_unverified"]
    },
    reviewDisposition: reviewDisposition(),
    generatedAt: generatedAt ?? new Date().toISOString()
  };
}

export function buildCanonicalQuestion(projection) {
  return {
    schemaVersion: "1.0",
    kind: "visual-synthetic-question",
    questionId: "synthetic-question-junior-readable-measurement-001",
    questionRef: "SYN-JP-MEAS-001",
    caseId: "junior-readable-measurement",
    subjectPack: "junior-physics-answer",
    fixtureKind: "synthetic_fixture",
    promptText: "The displayed length is measured in centimetres. What is the reading?",
    figureBinding: {
      cropRef: projection.crop.artifactRef,
      cropRawByteSha256: projection.crop.rawByteSha256,
      cropDecodedRgbPixelSha256: projection.crop.decodedRgbPixelSha256
    },
    interpretationAuthority: {
      quantityKind: "length",
      semanticRoleRequired: "measurement_reading",
      unit: { unitId: "centimetre", token: "centimetres", symbol: "cm" },
      valueSource: "bound_semantic_projection_recognized_text",
      unitSource: "explicit_question_text"
    },
    dataClassification: { level: "public", containsPersonalData: false },
    provenance: {
      authorityKind: "explicit_synthetic_question_declaration",
      liveProvider: false,
      cloudEgress: false
    },
    generatedAt: canonicalGeneratedAt.question
  };
}

export function materializeCanonicalFixtures() {
  const artifacts = compileCanonicalArtifacts();
  fs.mkdirSync(canonicalRoot, { recursive: true });
  for (const artifact of artifacts) {
    writeAtomically(path.join(canonicalRoot, artifact.name), artifact.bytes, true);
  }
  return artifacts.map(({ name }) => name);
}

export function validateCanonicalFixtures() {
  const expected = compileCanonicalArtifacts();
  const actualNames = fs.existsSync(canonicalRoot)
    ? fs.readdirSync(canonicalRoot).filter((name) => name.endsWith(".json")).sort()
    : [];
  const expectedNames = expected.map(({ name }) => name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("canonical OCR layout solver fixture set drifted");
  }
  for (const artifact of expected) {
    const actualBytes = fs.readFileSync(path.join(canonicalRoot, artifact.name));
    if (!actualBytes.equals(artifact.bytes)) {
      throw new Error(`${artifact.name} bytes drifted from deterministic compilation`);
    }
    const errors = validateValueAgainstSchema(artifact.value, artifact.schemaPath);
    if (errors.length > 0) {
      throw new Error(`${artifact.name} failed schema validation: ${errors.join("; ")}`);
    }
  }
  return expectedNames;
}

export function compileCanonicalRequest({ requestPath, outPath }) {
  const expectedRequestPath = path.join(canonicalRoot, "junior-readable-measurement.ocr-layout-solver-request.json");
  if (path.resolve(requestPath) !== path.resolve(expectedRequestPath)) {
    throw new Error("runtime accepts only the canonical OCR layout solver request");
  }
  const resolvedOutput = path.resolve(outPath);
  if (isWithin(resolvedOutput, repoRoot)) {
    throw new Error("runtime output must be outside repository authority");
  }
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("runtime output already exists");
  }
  validateCanonicalFixtures();
  const artifact = compileCanonicalArtifacts().find(({ name }) => name.endsWith(".track-b.json"));
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  const physicalOutput = path.join(
    fs.realpathSync(path.dirname(resolvedOutput)),
    path.basename(resolvedOutput)
  );
  if (isWithin(physicalOutput, fs.realpathSync(repoRoot))) {
    throw new Error("runtime output must be outside repository authority");
  }
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("runtime output already exists");
  }
  writeAtomically(resolvedOutput, artifact.bytes, false);
  return artifact.value;
}

function compileCanonicalArtifacts() {
  const projectionBytes = fs.readFileSync(projectionPath);
  const projection = JSON.parse(projectionBytes.toString("utf8"));
  const question = buildCanonicalQuestion(projection);
  const questionBytes = stableJsonBytes(question);
  const references = canonicalReferences(question);
  const evidenceBundle = buildProblemEvidenceBundle({
    question,
    questionBytes,
    projection,
    projectionBytes,
    generatedAt: canonicalGeneratedAt.evidenceBundle,
    references
  });
  const evidenceBundleBytes = stableJsonBytes(evidenceBundle);
  const request = buildSolverRequest({
    question,
    questionBytes,
    projection,
    projectionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    requestedAt: canonicalGeneratedAt.request,
    references
  });
  const trackResult = compileTrackResult({
    question,
    questionBytes,
    projection,
    projectionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    request,
    generatedAt: canonicalGeneratedAt.trackResult
  });
  trackResult.stageArtifactRefs.solverRequestRef = references.request;
  return [
    fixtureArtifact(path.basename(references.question), question, questionSchemaPath),
    fixtureArtifact(path.basename(references.evidenceBundle), evidenceBundle, evidenceBundleSchemaPath),
    fixtureArtifact(path.basename(references.request), request, requestSchemaPath),
    fixtureArtifact("junior-readable-measurement.track-b.json", trackResult, trackResultSchemaPath)
  ];
}

function fixtureArtifact(name, value, schemaPath) {
  return { name, value, bytes: stableJsonBytes(value), schemaPath };
}

function canonicalReferences(question) {
  return {
    question: `eval/ocr-layout-solver/cases/${question.caseId}.visual-synthetic-question.json`,
    projection: `eval/visual-semantic-projection/cases/${question.caseId}.visual-semantic-projection-result.json`,
    evidenceBundle: `eval/ocr-layout-solver/cases/${question.caseId}.problem-evidence-bundle.json`,
    request: `eval/ocr-layout-solver/cases/${question.caseId}.ocr-layout-solver-request.json`
  };
}

function artifactReferences(question, references = {}) {
  return {
    question: references.question ?? `${question.caseId}.visual-synthetic-question.json`,
    projection: references.projection ?? `${question.caseId}.visual-semantic-projection-result.json`,
    evidenceBundle: references.evidenceBundle ?? `${question.caseId}.problem-evidence-bundle.json`,
    request: references.request ?? `${question.caseId}.ocr-layout-solver-request.json`
  };
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeAtomically(targetPath, bytes, replaceExisting) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
    if (!replaceExisting && fs.existsSync(targetPath)) {
      throw new Error("runtime output already exists");
    }
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function validateQuestionAuthority(question) {
  if (question?.kind !== "visual-synthetic-question"
    || question.fixtureKind !== "synthetic_fixture"
    || question.dataClassification?.level !== "public"
    || question.dataClassification?.containsPersonalData !== false
    || question.provenance?.authorityKind !== "explicit_synthetic_question_declaration"
    || question.provenance?.liveProvider !== false
    || question.provenance?.cloudEgress !== false) {
    throw new Error("question authority is not an admitted public synthetic declaration");
  }
  const interpretation = question.interpretationAuthority;
  if (interpretation?.semanticRoleRequired !== "measurement_reading"
    || interpretation.valueSource !== "bound_semantic_projection_recognized_text"
    || interpretation.unitSource !== "explicit_question_text") {
    throw new Error("question interpretation authority is not admitted");
  }
  const token = interpretation.unit?.token;
  if (typeof token !== "string" || !containsWholeToken(question.promptText, token)) {
    throw new Error("unit token is not explicit in the question");
  }
}

function validateProjectionAuthority(question, projection) {
  if (projection?.kind !== "visual-semantic-projection-result"
    || projection.fixtureKind !== "synthetic_fixture"
    || projection.subjectPack !== question.subjectPack
    || projection.engineProvenance?.liveProvider !== false
    || projection.engineProvenance?.cloudEgress !== false
    || projection.dispositions?.semanticStatus !== "projected"
    || projection.dispositions?.requiresHumanReview !== true
    || projection.dispositions?.controlsDisposition !== "not_verified"
    || projection.dispositions?.eligible !== false) {
    throw new Error("semantic projection authority is not admitted for synthetic solving");
  }
  if (!sameCrop(question.figureBinding, projection.crop)) {
    throw new Error("crop binding drifted across question and semantic projection");
  }
  if (!Array.isArray(projection.projections) || projection.projections.length !== 1) {
    throw new Error("semantic projection must contain exactly one projected reading");
  }
  const projected = projection.projections[0];
  if (projected.semanticRole !== question.interpretationAuthority.semanticRoleRequired) {
    throw new Error("semantic role does not satisfy the question authority");
  }
  normalizeNumericValue(projected.recognizedText);
  return projected;
}

function validateCrossAuthorityBinding(question, projection, evidenceBundle, snapshots) {
  if (evidenceBundle?.questionId !== question.questionId
    || evidenceBundle.questionRef !== question.questionRef
    || evidenceBundle.subjectPack !== question.subjectPack) {
    throw new Error("question binding drifted across solver authorities");
  }
  if (evidenceBundle.kind !== "problem-evidence-bundle"
    || evidenceBundle.binding?.status !== "stable"
    || evidenceBundle.risk?.reviewRequired !== true
    || evidenceBundle.provenance?.sourceType !== "synthetic_question_evidence_bundle"
    || evidenceBundle.provenance?.liveProvider !== false
    || evidenceBundle.provenance?.egressPolicy?.allowCloud !== false) {
    throw new Error("problem evidence bundle is not admitted for synthetic solving");
  }
  if (evidenceBundle.questionBinding?.questionAuthoritySha256 !== sha256(snapshots.questionBytes)) {
    throw new Error("question authority hash drifted in the evidence bundle");
  }
  if (evidenceBundle.semanticEvidence?.projectionResultSha256 !== sha256(snapshots.projectionBytes)) {
    throw new Error("semantic projection hash drifted in the evidence bundle");
  }
  if (evidenceBundle.questionBinding?.status !== "stable"
    || !evidenceBundle.cropRefs?.includes(question.figureBinding.cropRef)) {
    throw new Error("question evidence binding is not stable");
  }
  const projected = projection.projections[0];
  if (evidenceBundle.semanticEvidence?.projectionId !== projected.projectionId
    || evidenceBundle.semanticEvidence?.semanticRole !== projected.semanticRole) {
    throw new Error("semantic evidence binding drifted across solver authorities");
  }
}

function validateRequestBindings(context) {
  const { question, questionBytes, projection, projectionBytes, evidenceBundle,
    evidenceBundleBytes, request, projected } = context;
  if (request?.kind !== "ocr-layout-solver-request"
    || request.fixtureKind !== "synthetic_fixture"
    || request.subjectPack !== question.subjectPack
    || request.question?.rawByteSha256 !== sha256(questionBytes)
    || request.question?.questionId !== question.questionId
    || request.question?.questionRef !== question.questionRef
    || request.evidenceBundle?.rawByteSha256 !== sha256(evidenceBundleBytes)
    || request.evidenceBundle?.evidenceBundleId !== evidenceBundle.evidenceBundleId
    || request.semanticProjection?.rawByteSha256 !== sha256(projectionBytes)
    || request.semanticProjection?.requestId !== projection.requestId
    || request.semanticProjection?.projectionId !== projected.projectionId
    || request.solverPolicySha256 !== solverPolicySha256()) {
    throw new Error("solver request authority binding drifted");
  }
  const expectedInterpretation = {
    quantityKind: question.interpretationAuthority.quantityKind,
    semanticRole: question.interpretationAuthority.semanticRoleRequired,
    unitId: question.interpretationAuthority.unit.unitId,
    unitSymbol: question.interpretationAuthority.unit.symbol,
    numericGrammar: "ascii_decimal"
  };
  if (JSON.stringify(request.expectedInterpretation) !== JSON.stringify(expectedInterpretation)) {
    throw new Error("solver request expected interpretation drifted");
  }
  if (JSON.stringify(request.dispositions) !== JSON.stringify(requestDispositions())) {
    throw new Error("solver request review disposition drifted");
  }
  if (request.question.artifactRef !== evidenceBundle.questionBinding.questionAuthorityRef
    || request.semanticProjection.artifactRef !== evidenceBundle.semanticEvidence.projectionResultRef) {
    throw new Error("solver request artifact references drifted");
  }
}

function normalizeNumericValue(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+|\d+\.\d+)$/.test(text)) {
    throw new Error("recognized text is not an admitted decimal number");
  }
  return text.startsWith("+") ? text.slice(1) : text;
}

function containsWholeToken(text, token) {
  if (typeof text !== "string") {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(text);
}

function sameCrop(figureBinding, crop) {
  return crop?.artifactRef === figureBinding?.cropRef
    && crop.rawByteSha256 === figureBinding.cropRawByteSha256
    && crop.decodedRgbPixelSha256 === figureBinding.cropDecodedRgbPixelSha256;
}

function requireSnapshot(value, bytes, label) {
  let snapshottedValue;
  try {
    snapshottedValue = Buffer.isBuffer(bytes)
      ? JSON.parse(bytes.toString("utf8"))
      : undefined;
  } catch {
    snapshottedValue = undefined;
  }
  if (snapshottedValue === undefined
    || JSON.stringify(snapshottedValue) !== JSON.stringify(value)) {
    throw new Error(`${label} bytes drifted`);
  }
}

function requestDispositions() {
  return {
    diagnosticScope: "public_synthetic_ocr_layout_solver",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function reviewDisposition() {
  return {
    status: "review_required",
    reasonCodes: ["synthetic_track_b_requires_review", "acceptance_tier_unverified"],
    humanApproved: false,
    trusted: false,
    visualReviewPassed: null,
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function usage() {
  return [
    "Usage:",
    "  node ocr-layout-solver.mjs materialize",
    "  node ocr-layout-solver.mjs validate",
    "  node ocr-layout-solver.mjs compile --request <canonical-request> --out <external-path>"
  ].join("\n");
}

function requireFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`${flag} is required\n\n${usage()}`);
  }
  return path.resolve(repoRoot, args[index + 1]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "materialize") {
    console.log(JSON.stringify({ materialized: materializeCanonicalFixtures() }, null, 2));
    return;
  }
  if (args[0] === "validate") {
    console.log(JSON.stringify({ validated: validateCanonicalFixtures() }, null, 2));
    return;
  }
  if (args[0] === "compile") {
    const result = compileCanonicalRequest({
      requestPath: requireFlag(args, "--request"),
      outPath: requireFlag(args, "--out")
    });
    console.log(JSON.stringify({ trackResultId: result.trackResultId }, null, 2));
    return;
  }
  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
