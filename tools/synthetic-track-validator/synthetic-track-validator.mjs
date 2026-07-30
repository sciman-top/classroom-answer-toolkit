import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { solverPolicySha256 } from "../ocr-layout-solver/ocr-layout-solver.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const canonicalRoot = path.join(repoRoot, "eval", "synthetic-track-validator", "cases");
const upstreamRoot = path.join(repoRoot, "eval", "ocr-layout-solver", "cases");
const projectionPath = path.join(
  repoRoot,
  "eval",
  "visual-semantic-projection",
  "cases",
  "junior-readable-measurement.visual-semantic-projection-result.json"
);
const upstreamPaths = Object.freeze({
  question: path.join(upstreamRoot, "junior-readable-measurement.visual-synthetic-question.json"),
  evidenceBundle: path.join(upstreamRoot, "junior-readable-measurement.problem-evidence-bundle.json"),
  solverRequest: path.join(upstreamRoot, "junior-readable-measurement.ocr-layout-solver-request.json"),
  trackB: path.join(upstreamRoot, "junior-readable-measurement.track-b.json")
});
const requestSchemaPath = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "synthetic-track-validator-request.schema.json"
);
const consistencyReportSchemaPath = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "consistency-report.schema.json"
);
const trackResultSchemaPath = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas",
  "track-result.schema.json"
);
const canonicalGeneratedAt = Object.freeze({
  request: "2026-07-30T02:00:00Z",
  result: "2026-07-30T02:00:01Z"
});
const CHECK_IDS = Object.freeze([
  "question_binding_exact",
  "quantity_binding_exact",
  "unit_binding_exact",
  "numeric_format_valid",
  "answer_format_exact",
  "semantic_evidence_exact",
  "review_boundary_preserved"
]);
const VALIDATOR_POLICY = Object.freeze({
  inputAuthority: "five_raw_byte_bound_canonical_artifacts",
  questionBinding: "exact_identity_and_hash",
  quantityBinding: "explicit_question_authority",
  unitBinding: "explicit_whole_token_and_structured_unit",
  numericGrammar: "ascii_decimal",
  answerFormat: "normalized_numeric_ascii_space_unit_symbol",
  semanticEvidence: "projection_solver_request_and_track_b_provenance",
  reviewBoundary: "always_review_synthetic_track_c",
  failureDisposition: "blocking"
});

export function stableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validatorPolicySha256() {
  return sha256(stableJsonBytes(VALIDATOR_POLICY));
}

export function buildValidatorRequest({
  question,
  questionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  projection,
  projectionBytes,
  solverRequest,
  solverRequestBytes,
  trackB,
  trackBBytes,
  requestedAt,
  references
}) {
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  requireSnapshot(projection, projectionBytes, "semantic projection authority");
  requireSnapshot(solverRequest, solverRequestBytes, "solver request authority");
  requireSnapshot(trackB, trackBBytes, "Track B authority");
  const refs = artifactReferences(references);
  return {
    schemaVersion: "1.0",
    kind: "synthetic-track-validator-request",
    requestId: "junior-readable-measurement-synthetic-track-validator",
    subjectPack: question.subjectPack,
    fixtureKind: "synthetic_fixture",
    requestArtifactRef: refs.request,
    inputs: {
      question: artifactBinding(refs.question, questionBytes, {
        questionId: question.questionId,
        questionRef: question.questionRef
      }),
      evidenceBundle: artifactBinding(refs.evidenceBundle, evidenceBundleBytes, {
        evidenceBundleId: evidenceBundle.evidenceBundleId
      }),
      semanticProjection: artifactBinding(refs.projection, projectionBytes, {
        requestId: projection.requestId,
        projectionId: projection.projections?.[0]?.projectionId
      }),
      solverRequest: artifactBinding(refs.solverRequest, solverRequestBytes, {
        requestId: solverRequest.requestId
      }),
      trackB: artifactBinding(refs.trackB, trackBBytes, {
        trackResultId: trackB.trackResultId
      })
    },
    outputs: {
      consistencyReportRef: refs.consistencyReport,
      trackResultRef: refs.trackC
    },
    expectedCheckIds: [...CHECK_IDS],
    validatorPolicySha256: validatorPolicySha256(),
    dispositions: requestDispositions(),
    requestedAt: requestedAt ?? new Date().toISOString()
  };
}

export function compileValidation(context) {
  const {
    question,
    questionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    projection,
    projectionBytes,
    solverRequest,
    solverRequestBytes,
    trackB,
    trackBBytes,
    request
  } = context;
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  requireSnapshot(projection, projectionBytes, "semantic projection authority");
  requireSnapshot(solverRequest, solverRequestBytes, "solver request authority");
  requireSnapshot(trackB, trackBBytes, "Track B authority");
  validateRequestBindings(context);

  const checks = buildChecks(context);
  const blockingChecks = checks.filter((check) => check.status === "blocking");
  const groundingSufficient = blockingChecks.length === 0;
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const consistencyReport = {
    schemaVersion: "1.0",
    kind: "consistency-report",
    consistencyReportId: "consistency-junior-readable-measurement-synthetic-track-c",
    evidenceBundleRef: evidenceBundle.evidenceBundleId,
    trackResultRefs: [trackB.trackResultId],
    validationScope: "public_synthetic_track_c_validator",
    inputBindings: {
      questionSha256: sha256(questionBytes),
      evidenceBundleSha256: sha256(evidenceBundleBytes),
      semanticProjectionSha256: sha256(projectionBytes),
      solverRequestSha256: sha256(solverRequestBytes),
      trackBSha256: sha256(trackBBytes),
      validatorRequestSha256: sha256(stableJsonBytes(request)),
      validatorPolicySha256: validatorPolicySha256()
    },
    checks,
    unsafeShortcutFail: false,
    groundingSufficient,
    recommendedDecisionReasons: groundingSufficient
      ? ["acceptance_tier_unverified"]
      : ["rule_validator_failed", "acceptance_tier_unverified"],
    validatorProvenance: validatorProvenance(),
    dispositions: resultDispositions(),
    generatedAt
  };
  const validatorFindings = blockingChecks.map((check) => ({
    findingId: check.checkId,
    severity: "blocking",
    message: check.message,
    evidenceRef: check.evidenceRef
  }));
  const trackResult = {
    schemaVersion: "1.0",
    kind: "track-result",
    trackResultId: "track-c-junior-readable-measurement-synthetic",
    evidenceBundleRef: evidenceBundle.evidenceBundleId,
    trackType: "rule_validator",
    candidateSourceType: "generated",
    answerCandidate: groundingSufficient
      ? `validated: ${trackB.answerCandidate}`
      : "blocked: synthetic track validation failed",
    confidence: 1,
    visualDetailMode: "not_applicable",
    requestedVisualDetailMode: "not_applicable",
    providerVisualDetailMode: "not_applicable",
    acceptanceTier: "repo_side_synthetic_diagnostic",
    stageArtifactRefs: {
      consistencyReportRef: request.outputs.consistencyReportRef,
      sourceTrackResultRef: request.inputs.trackB.artifactRef,
      validatorRequestRef: request.requestArtifactRef
    },
    questionBinding: {
      status: checkPassed(checks, "question_binding_exact") ? "exact" : "ambiguous",
      questionId: question.questionId,
      questionRef: question.questionRef,
      questionAuthoritySha256: sha256(questionBytes),
      evidenceBundleRef: evidenceBundle.evidenceBundleId
    },
    validatorProvenance: {
      ...validatorProvenance(),
      sourceRequestSha256: sha256(stableJsonBytes(request)),
      questionAuthoritySha256: sha256(questionBytes),
      evidenceBundleSha256: sha256(evidenceBundleBytes),
      semanticProjectionSha256: sha256(projectionBytes),
      solverRequestSha256: sha256(solverRequestBytes),
      sourceTrackResultSha256: sha256(trackBBytes),
      validatorPolicySha256: validatorPolicySha256()
    },
    visibleEvidenceSummary: groundingSufficient
      ? "Seven synthetic Track C checks passed; acceptance remains unverified and review is required."
      : `${blockingChecks.length} synthetic Track C check(s) blocked the candidate.`,
    evidenceRefs: [
      evidenceBundle.evidenceBundleId,
      projection.projections?.[0]?.projectionId ?? projection.requestId,
      trackB.trackResultId,
      consistencyReport.consistencyReportId
    ],
    conflictRefs: blockingChecks.map((check) => check.checkId),
    missingEvidenceRefs: [],
    validatorFindings,
    risk: {
      level: "high",
      reviewRequired: true,
      reasons: unique([
        "synthetic_track_c_requires_review",
        "acceptance_tier_unverified",
        groundingSufficient ? undefined : "rule_validator_failed"
      ])
    },
    reviewDisposition: reviewDisposition(),
    generatedAt
  };
  return { consistencyReport, trackResult };
}

export function materializeCanonicalFixtures() {
  const artifacts = compileCanonicalArtifacts();
  fs.mkdirSync(canonicalRoot, { recursive: true });
  for (const artifact of artifacts) {
    writeFileAtomically(path.join(canonicalRoot, artifact.name), artifact.bytes);
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
    throw new Error("canonical synthetic Track C validator fixture set drifted");
  }
  for (const artifact of expected) {
    const actualBytes = fs.readFileSync(path.join(canonicalRoot, artifact.name));
    if (!actualBytes.equals(artifact.bytes)) {
      throw new Error(`${artifact.name} bytes drifted from deterministic compilation`);
    }
    validateArtifact(artifact);
  }
  return expectedNames;
}

export function compileCanonicalRequest({ requestPath, outDir }) {
  const expectedRequestPath = path.join(
    canonicalRoot,
    "junior-readable-measurement.synthetic-track-validator-request.json"
  );
  if (path.resolve(requestPath) !== path.resolve(expectedRequestPath)) {
    throw new Error("runtime accepts only the canonical synthetic Track C validator request");
  }
  const resolvedOutput = path.resolve(outDir);
  if (isWithin(resolvedOutput, repoRoot)) {
    throw new Error("runtime output must be outside repository authority");
  }
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("runtime output directory already exists");
  }
  validateCanonicalFixtures();
  const artifacts = compileCanonicalArtifacts().filter(({ name }) => !name.endsWith("request.json"));
  const parent = path.dirname(resolvedOutput);
  fs.mkdirSync(parent, { recursive: true });
  const physicalOutput = path.join(fs.realpathSync(parent), path.basename(resolvedOutput));
  if (isWithin(physicalOutput, fs.realpathSync(repoRoot))) {
    throw new Error("runtime output must be outside repository authority");
  }
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("runtime output directory already exists");
  }
  const stagedOutput = `${resolvedOutput}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(stagedOutput);
    for (const artifact of artifacts) {
      validateArtifact(artifact);
      fs.writeFileSync(path.join(stagedOutput, artifact.name), artifact.bytes, { flag: "wx" });
    }
    fs.renameSync(stagedOutput, resolvedOutput);
  } finally {
    if (fs.existsSync(stagedOutput)) {
      fs.rmSync(stagedOutput, { recursive: true, force: true });
    }
  }
  const consistencyReport = artifacts.find(({ name }) => name.endsWith("consistency-report.json")).value;
  const trackResult = artifacts.find(({ name }) => name.endsWith("track-c.json")).value;
  return { consistencyReport, trackResult };
}

function buildChecks(context) {
  const { question, questionBytes, evidenceBundle, projection, projectionBytes,
    solverRequest, solverRequestBytes, trackB } = context;
  const unit = question.interpretationAuthority?.unit;
  const projected = Array.isArray(projection.projections) && projection.projections.length === 1
    ? projection.projections[0]
    : undefined;
  const numericValue = normalizeNumeric(trackB.interpretation?.numericValue);
  return [
    makeCheck(
      "question_binding_exact",
      question?.kind === "visual-synthetic-question"
        && question.fixtureKind === "synthetic_fixture"
        && question.dataClassification?.level === "public"
        && question.dataClassification?.containsPersonalData === false
        && evidenceBundle.questionId === question.questionId
        && evidenceBundle.questionRef === question.questionRef
        && evidenceBundle.subjectPack === question.subjectPack
        && evidenceBundle.questionBinding?.status === "stable"
        && evidenceBundle.questionBinding?.questionAuthoritySha256 === sha256(questionBytes)
        && trackB.questionBinding?.status === "exact"
        && trackB.questionBinding?.questionId === question.questionId
        && trackB.questionBinding?.questionRef === question.questionRef
        && trackB.questionBinding?.questionAuthoritySha256 === sha256(questionBytes)
        && trackB.evidenceBundleRef === evidenceBundle.evidenceBundleId,
      "Question identity and authority hashes are exact across question, bundle, and Track B.",
      "Question identity or authority binding differs across Track C inputs.",
      requestEvidenceRef(context)
    ),
    makeCheck(
      "quantity_binding_exact",
      question.interpretationAuthority?.quantityKind === "length"
        && trackB.interpretation?.quantityKind === question.interpretationAuthority.quantityKind,
      "Track B quantity equals the explicit question quantity authority.",
      "Track B quantity does not equal the explicit question quantity authority.",
      context.request.inputs.question.artifactRef
    ),
    makeCheck(
      "unit_binding_exact",
      unit?.unitId === "centimetre"
        && unit.symbol === "cm"
        && containsWholeToken(question.promptText, unit.token)
        && trackB.interpretation?.unitId === unit.unitId
        && trackB.interpretation?.unitSymbol === unit.symbol,
      "Track B unit equals the explicit whole-token question unit authority.",
      "Track B unit or explicit question unit token is inconsistent.",
      context.request.inputs.question.artifactRef
    ),
    makeCheck(
      "numeric_format_valid",
      numericValue !== undefined,
      "Track B numeric value satisfies the admitted ASCII-decimal grammar.",
      "Track B numeric value does not satisfy the admitted ASCII-decimal grammar.",
      context.request.inputs.trackB.artifactRef
    ),
    makeCheck(
      "answer_format_exact",
      numericValue !== undefined
        && typeof unit?.symbol === "string"
        && trackB.answerCandidate === `${numericValue} ${unit.symbol}`,
      "Track B answer uses exact normalized numeric-space-unit format.",
      "Track B answer does not use exact normalized numeric-space-unit format.",
      context.request.inputs.trackB.artifactRef
    ),
    makeCheck(
      "semantic_evidence_exact",
      projected !== undefined
        && projected.semanticRole === "measurement_reading"
        && projected.semanticRole === question.interpretationAuthority?.semanticRoleRequired
        && projected.semanticRole === trackB.interpretation?.semanticRole
        && projected.recognizedText === trackB.interpretation?.numericValue
        && evidenceBundle.semanticEvidence?.projectionResultSha256 === sha256(projectionBytes)
        && evidenceBundle.semanticEvidence?.projectionId === projected.projectionId
        && evidenceBundle.semanticEvidence?.semanticRole === projected.semanticRole
        && solverRequest.semanticProjection?.rawByteSha256 === sha256(projectionBytes)
        && solverRequest.evidenceBundle?.rawByteSha256 === sha256(context.evidenceBundleBytes)
        && solverRequest.question?.rawByteSha256 === sha256(questionBytes)
        && solverRequest.solverPolicySha256 === solverPolicySha256()
        && trackB.answerCandidateProvenance?.sourceRequestSha256 === sha256(solverRequestBytes)
        && trackB.answerCandidateProvenance?.questionAuthoritySha256 === sha256(questionBytes)
        && trackB.answerCandidateProvenance?.evidenceBundleSha256 === sha256(context.evidenceBundleBytes)
        && trackB.answerCandidateProvenance?.semanticProjectionSha256 === sha256(projectionBytes)
        && trackB.answerCandidateProvenance?.solverPolicySha256 === solverPolicySha256(),
      "Projection, solver request, bundle, and Track B provenance bind one semantic reading.",
      "Semantic projection or Track B provenance does not bind the current authorities.",
      context.request.inputs.semanticProjection.artifactRef
    ),
    makeCheck(
      "review_boundary_preserved",
      trackB.trackType === "ocr_layout_solver"
        && trackB.candidateSourceType === "generated"
        && trackB.risk?.level === "high"
        && trackB.risk?.reviewRequired === true
        && trackB.reviewDisposition?.status === "review_required"
        && trackB.reviewDisposition?.humanApproved === false
        && trackB.reviewDisposition?.trusted === false
        && trackB.reviewDisposition?.visualReviewPassed === null
        && trackB.reviewDisposition?.controlsDisposition === "not_verified"
        && trackB.reviewDisposition?.eligible === false
        && Array.isArray(trackB.reviewDisposition?.optimizationCandidateRefs)
        && trackB.reviewDisposition.optimizationCandidateRefs.length === 0,
      "Track B preserves synthetic review, trust, control, and eligibility boundaries.",
      "Track B relaxed a required review, trust, control, or eligibility boundary.",
      context.request.inputs.trackB.artifactRef
    )
  ];
}

function makeCheck(checkId, passed, passMessage, failMessage, evidenceRef) {
  return {
    checkId,
    status: passed ? "pass" : "blocking",
    message: passed ? passMessage : failMessage,
    evidenceRef
  };
}

function validateRequestBindings(context) {
  const { question, questionBytes, evidenceBundle, evidenceBundleBytes, projection, projectionBytes,
    solverRequest, solverRequestBytes, trackB, trackBBytes, request } = context;
  const inputs = request?.inputs;
  if (request?.kind !== "synthetic-track-validator-request"
    || request.subjectPack !== question.subjectPack
    || request.fixtureKind !== "synthetic_fixture"
    || inputs?.question?.rawByteSha256 !== sha256(questionBytes)
    || inputs.question.questionId !== question.questionId
    || inputs.question.questionRef !== question.questionRef
    || inputs.evidenceBundle?.rawByteSha256 !== sha256(evidenceBundleBytes)
    || inputs.evidenceBundle.evidenceBundleId !== evidenceBundle.evidenceBundleId
    || inputs.semanticProjection?.rawByteSha256 !== sha256(projectionBytes)
    || inputs.semanticProjection.requestId !== projection.requestId
    || inputs.semanticProjection.projectionId !== projection.projections?.[0]?.projectionId
    || inputs.solverRequest?.rawByteSha256 !== sha256(solverRequestBytes)
    || inputs.solverRequest.requestId !== solverRequest.requestId
    || inputs.trackB?.rawByteSha256 !== sha256(trackBBytes)
    || inputs.trackB.trackResultId !== trackB.trackResultId
    || request.validatorPolicySha256 !== validatorPolicySha256()
    || JSON.stringify(request.expectedCheckIds) !== JSON.stringify(CHECK_IDS)
    || JSON.stringify(request.dispositions) !== JSON.stringify(requestDispositions())) {
    throw new Error("validator request input binding drifted");
  }
  const references = canonicalReferences();
  if (request.requestArtifactRef !== references.request
    || inputs.question.artifactRef !== references.question
    || inputs.evidenceBundle.artifactRef !== references.evidenceBundle
    || inputs.semanticProjection.artifactRef !== references.projection
    || inputs.solverRequest.artifactRef !== references.solverRequest
    || inputs.trackB.artifactRef !== references.trackB
    || request.outputs?.consistencyReportRef !== references.consistencyReport
    || request.outputs?.trackResultRef !== references.trackC
    || inputs.question.artifactRef !== evidenceBundle.questionBinding?.questionAuthorityRef
    || inputs.evidenceBundle.artifactRef !== solverRequest.evidenceBundle?.artifactRef
    || inputs.semanticProjection.artifactRef !== evidenceBundle.semanticEvidence?.projectionResultRef
    || inputs.semanticProjection.artifactRef !== solverRequest.semanticProjection?.artifactRef
    || inputs.solverRequest.artifactRef !== solverRequest.requestArtifactRef
    || inputs.solverRequest.artifactRef !== trackB.stageArtifactRefs?.solverRequestRef) {
    throw new Error("validator request artifact reference drifted");
  }
}

function compileCanonicalArtifacts() {
  const context = readCanonicalContext();
  const references = canonicalReferences();
  const request = buildValidatorRequest({
    ...context,
    requestedAt: canonicalGeneratedAt.request,
    references
  });
  const result = compileValidation({
    ...context,
    request,
    generatedAt: canonicalGeneratedAt.result
  });
  return [
    artifact(path.basename(references.request), request, requestSchemaPath),
    artifact(path.basename(references.consistencyReport), result.consistencyReport, consistencyReportSchemaPath),
    artifact(path.basename(references.trackC), result.trackResult, trackResultSchemaPath)
  ];
}

function readCanonicalContext() {
  return {
    ...readAuthority("question", upstreamPaths.question),
    ...readAuthority("evidenceBundle", upstreamPaths.evidenceBundle),
    ...readAuthority("projection", projectionPath),
    ...readAuthority("solverRequest", upstreamPaths.solverRequest),
    ...readAuthority("trackB", upstreamPaths.trackB)
  };
}

function readAuthority(name, filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    [name]: JSON.parse(bytes.toString("utf8")),
    [`${name}Bytes`]: bytes
  };
}

function artifact(name, value, schemaPath) {
  return { name, value, bytes: stableJsonBytes(value), schemaPath };
}

function validateArtifact(value) {
  const errors = validateValueAgainstSchema(value.value, value.schemaPath);
  if (errors.length > 0) {
    throw new Error(`${value.name} failed schema validation: ${errors.join("; ")}`);
  }
}

function artifactBinding(artifactRef, bytes, identity) {
  return { artifactRef, rawByteSha256: sha256(bytes), ...identity };
}

function artifactReferences(references = {}) {
  return { ...canonicalReferences(), ...references };
}

function canonicalReferences() {
  return {
    question: "eval/ocr-layout-solver/cases/junior-readable-measurement.visual-synthetic-question.json",
    evidenceBundle: "eval/ocr-layout-solver/cases/junior-readable-measurement.problem-evidence-bundle.json",
    projection: "eval/visual-semantic-projection/cases/junior-readable-measurement.visual-semantic-projection-result.json",
    solverRequest: "eval/ocr-layout-solver/cases/junior-readable-measurement.ocr-layout-solver-request.json",
    trackB: "eval/ocr-layout-solver/cases/junior-readable-measurement.track-b.json",
    request: "eval/synthetic-track-validator/cases/junior-readable-measurement.synthetic-track-validator-request.json",
    consistencyReport: "eval/synthetic-track-validator/cases/junior-readable-measurement.consistency-report.json",
    trackC: "eval/synthetic-track-validator/cases/junior-readable-measurement.track-c.json"
  };
}

function requestDispositions() {
  return {
    validationScope: "public_synthetic_track_c_validator",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function resultDispositions() {
  return {
    trackDisposition: "validated_not_orchestrated",
    requiresHumanReview: true,
    deliveryTrustDisposition: "not_projected",
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function reviewDisposition() {
  return {
    status: "review_required",
    reasonCodes: ["synthetic_track_c_requires_review", "acceptance_tier_unverified"],
    humanApproved: false,
    trusted: false,
    visualReviewPassed: null,
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function validatorProvenance() {
  return {
    engineKind: "deterministic_rule_validator",
    engineId: "synthetic-track-validator",
    engineVersion: "1.0.0",
    liveProvider: false,
    cloudEgress: false
  };
}

function normalizeNumeric(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+|\d+\.\d+)$/.test(text)) {
    return undefined;
  }
  return text.startsWith("+") ? text.slice(1) : text;
}

function containsWholeToken(text, token) {
  if (typeof text !== "string" || typeof token !== "string") {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(text);
}

function requestEvidenceRef(context) {
  return context.request.inputs.question.artifactRef;
}

function checkPassed(checks, checkId) {
  return checks.find((check) => check.checkId === checkId)?.status === "pass";
}

function requireSnapshot(value, bytes, label) {
  let snapshotted;
  try {
    snapshotted = Buffer.isBuffer(bytes) ? JSON.parse(bytes.toString("utf8")) : undefined;
  } catch {
    snapshotted = undefined;
  }
  if (snapshotted === undefined || JSON.stringify(snapshotted) !== JSON.stringify(value)) {
    throw new Error(`${label} bytes drifted`);
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeFileAtomically(targetPath, bytes) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function usage() {
  return [
    "Usage:",
    "  node synthetic-track-validator.mjs materialize",
    "  node synthetic-track-validator.mjs validate",
    "  node synthetic-track-validator.mjs compile --request <canonical-request> --out-dir <external-directory>"
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
      outDir: requireFlag(args, "--out-dir")
    });
    console.log(JSON.stringify({ trackResultId: result.trackResult.trackResultId }, null, 2));
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
