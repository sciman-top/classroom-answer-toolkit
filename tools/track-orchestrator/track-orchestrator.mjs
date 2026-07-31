import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  compileDecisionRecord,
  normalizeAnswerCandidate,
  validateDecisionRecord
} from "../visual-evidence/decision-record.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const canonicalRoot = path.join(repoRoot, "eval", "track-orchestration", "cases");
const upstreamRoot = path.join(repoRoot, "eval", "ocr-layout-solver", "cases");
const trackCRoot = path.join(repoRoot, "eval", "synthetic-track-validator", "cases");
const requestSchemaPath = path.join(
  repoRoot, "prompts", "shared", "schemas", "track-orchestration-request.schema.json"
);
const reportSchemaPath = path.join(
  repoRoot, "prompts", "shared", "schemas", "track-orchestration-report.schema.json"
);
const trackResultSchemaPath = path.join(
  repoRoot, "prompts", "shared", "schemas", "track-result.schema.json"
);
const problemEvidenceBundleSchemaPath = path.join(
  repoRoot, "prompts", "shared", "schemas", "problem-evidence-bundle.schema.json"
);
const EXPECTED_TRACK_TYPES = Object.freeze(["vlm_direct", "ocr_layout_solver", "rule_validator"]);
const ORCHESTRATION_POLICY = Object.freeze({
  sourceAdmission: "repository_relative_current_raw_bytes",
  identityBinding: "question_evidence_bundle_and_track_type_exact",
  candidateComparison: "canonical_decision_record_normalization",
  degradation: "missing_expected_track_is_evidence_missing",
  validatorBlocking: "track_c_blocking_findings_are_preserved",
  decisionAuthority: "tools/visual-evidence/decision-record.mjs",
  reviewBoundary: "always_review_public_synthetic_orchestration"
});
const canonicalTimes = Object.freeze({
  trackA: "2026-07-30T04:00:00Z",
  request: "2026-07-30T04:00:01Z",
  result: "2026-07-30T04:00:02Z"
});

export function stableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function orchestrationPolicySha256() {
  return sha256(stableJsonBytes(ORCHESTRATION_POLICY));
}

export function buildSyntheticTrackA({
  question,
  questionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  generatedAt = new Date().toISOString()
}) {
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  validateQuestionAndBundle(question, questionBytes, evidenceBundle, evidenceBundleBytes);
  const unit = question.interpretationAuthority?.unit;
  const numericValue = "12";
  return {
    schemaVersion: "1.0",
    kind: "track-result",
    trackResultId: "track-a-junior-readable-measurement-synthetic",
    evidenceBundleRef: evidenceBundle.evidenceBundleId,
    trackType: "vlm_direct",
    candidateSourceType: "generated",
    answerCandidate: `${numericValue} ${unit.symbol}`,
    confidence: 1,
    visualDetailMode: "not_applicable",
    requestedVisualDetailMode: "not_applicable",
    providerVisualDetailMode: "not_applicable",
    acceptanceTier: "repo_side_synthetic_diagnostic",
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
      semanticRole: question.interpretationAuthority.semanticRoleRequired,
      interpretationMode: "explicit_public_synthetic_track_a_declaration"
    },
    syntheticTrackProvenance: {
      authorityKind: "independent_public_synthetic_track_a",
      questionAuthoritySha256: sha256(questionBytes),
      evidenceBundleSha256: sha256(evidenceBundleBytes),
      liveProvider: false,
      cloudEgress: false
    },
    visibleEvidenceSummary: "Independent public synthetic Track A candidate for orchestration plumbing.",
    evidenceRefs: [...evidenceBundle.evidenceRefs],
    conflictRefs: [],
    missingEvidenceRefs: [],
    validatorFindings: [],
    risk: {
      level: "high",
      reviewRequired: true,
      reasons: ["synthetic_track_a_requires_review", "acceptance_tier_unverified"]
    },
    reviewDisposition: reviewDisposition("synthetic_track_a_requires_review"),
    generatedAt
  };
}

export function buildOrchestrationRequest({
  question,
  questionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  tracks,
  expectedTrackTypes = EXPECTED_TRACK_TYPES,
  requestedAt = new Date().toISOString(),
  references = canonicalReferences()
}) {
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  for (const track of tracks) {
    requireSnapshot(track.value, track.bytes, `${track.value.trackType} authority`);
  }
  const request = {
    schemaVersion: "1.0",
    kind: "track-orchestration-request",
    requestId: "junior-readable-measurement-track-orchestration",
    subjectPack: question.subjectPack,
    fixtureKind: "synthetic_fixture",
    requestArtifactRef: references.request,
    question: artifactBinding(references.question, questionBytes, {
      questionId: question.questionId,
      questionRef: question.questionRef
    }),
    evidenceBundle: artifactBinding(references.evidenceBundle, evidenceBundleBytes, {
      evidenceBundleId: evidenceBundle.evidenceBundleId
    }),
    tracks: tracks.map((track) => artifactBinding(track.artifactRef, track.bytes, {
      trackType: track.value.trackType,
      trackResultId: track.value.trackResultId
    })),
    expectedTrackTypes: [...expectedTrackTypes],
    outputs: {
      orchestrationReportRef: references.report,
      decisionRecordRef: references.decisionRecord
    },
    orchestrationPolicySha256: orchestrationPolicySha256(),
    dispositions: requestDispositions(),
    requestedAt
  };
  assertSchema(request, requestSchemaPath, "orchestration request");
  return request;
}

export function orchestrateTracks({
  question,
  questionBytes,
  evidenceBundle,
  evidenceBundleBytes,
  tracks,
  request,
  requestBytes,
  generatedAt = new Date().toISOString()
}) {
  requireSnapshot(question, questionBytes, "question authority");
  requireSnapshot(evidenceBundle, evidenceBundleBytes, "problem evidence bundle");
  requireSnapshot(request, requestBytes, "orchestration request");
  for (const track of tracks) {
    requireSnapshot(track.value, track.bytes, `${track.value.trackType} authority`);
  }
  assertSchema(request, requestSchemaPath, "orchestration request");
  validateQuestionAndBundle(question, questionBytes, evidenceBundle, evidenceBundleBytes);
  validateRequestBindings({
    question, questionBytes, evidenceBundle, evidenceBundleBytes, tracks, request
  });

  const trackResults = tracks.map((track) => track.value);
  const presentTrackTypes = trackResults.map((track) => track.trackType);
  const missingTrackTypes = request.expectedTrackTypes.filter(
    (trackType) => !presentTrackTypes.includes(trackType)
  );
  const comparison = compareCandidateTracks(trackResults);
  const trackCDisposition = compileTrackCDisposition(trackResults);
  const decisionRecord = compileDecisionRecord({
    evidenceBundle,
    trackResults,
    requiredTrackTypes: request.expectedTrackTypes,
    generatedAt,
    humanApproved: false
  });
  const decisionErrors = validateDecisionRecord(decisionRecord);
  if (decisionErrors.length > 0) {
    throw new Error(`DecisionRecord compilation failed: ${decisionErrors.join("; ")}`);
  }
  const decisionRecordBytes = stableJsonBytes(decisionRecord);
  const report = {
    schemaVersion: "1.0",
    kind: "track-orchestration-report",
    orchestrationReportId: "track-orchestration-junior-readable-measurement-synthetic",
    requestRef: request.requestArtifactRef,
    requestSha256: sha256(requestBytes),
    questionBinding: admittedBinding(request.question),
    evidenceBundleBinding: admittedBinding(request.evidenceBundle),
    sourceTracks: tracks.map((track) => ({
      trackType: track.value.trackType,
      trackResultId: track.value.trackResultId,
      artifactRef: track.artifactRef,
      rawByteSha256: sha256(track.bytes),
      admissionStatus: "admitted",
      normalizedCandidate: track.value.trackType === "rule_validator"
        ? null
        : normalizeAnswerCandidate(track.value.answerCandidate) || null,
      blockingFindingCount: blockingFindings(track.value).length
    })),
    expectedTrackTypes: [...request.expectedTrackTypes],
    presentTrackTypes,
    missingTrackTypes,
    orchestrationStatus: missingTrackTypes.length > 0 ? "degraded" : "complete",
    comparison,
    trackCDisposition,
    sourceBlockingFindingRefs: trackResults.flatMap((track) =>
      blockingFindings(track).map((finding) => `${track.trackResultId}:${finding.findingId}`)
    ),
    decisionCompiler: {
      implementationRef: "tools/visual-evidence/decision-record.mjs",
      decisionRecordRef: request.outputs.decisionRecordRef,
      decisionRecordSha256: sha256(decisionRecordBytes),
      decision: decisionRecord.decision,
      trusted: decisionRecord.trusted
    },
    dispositions: resultDispositions(),
    generatedAt
  };
  assertSchema(report, reportSchemaPath, "orchestration report");
  return { report, decisionRecord };
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
  const expectedNames = expected.map((artifact) => artifact.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("canonical orchestration fixture inventory drifted");
  }
  for (const artifact of expected) {
    const actualBytes = fs.readFileSync(path.join(canonicalRoot, artifact.name));
    if (!actualBytes.equals(artifact.bytes)) {
      throw new Error(`${artifact.name} is not byte-exact`);
    }
    assertSchema(artifact.value, artifact.schemaPath, artifact.name);
  }
  return expected.map(({ name }) => name);
}

export function compileRequest({ requestPath, outDir }) {
  const absoluteRequestPath = assertRepositoryFile(requestPath, "orchestration request");
  const requestAuthority = readAuthority(absoluteRequestPath);
  const request = requestAuthority.value;
  assertSchema(request, requestSchemaPath, "orchestration request");
  if (request.requestArtifactRef !== toRepoRef(absoluteRequestPath)) {
    throw new Error("orchestration request artifact reference does not match current bytes");
  }

  const question = loadBoundArtifact(request.question, "question authority");
  const evidenceBundle = loadBoundArtifact(request.evidenceBundle, "problem evidence bundle");
  const tracks = request.tracks.map((binding) => {
    const authority = loadBoundArtifact(binding, `${binding.trackType} authority`);
    return { value: authority.value, bytes: authority.bytes, artifactRef: binding.artifactRef };
  });
  const result = orchestrateTracks({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    tracks,
    request,
    requestBytes: requestAuthority.bytes
  });
  writeOutputDirectory(outDir, request.outputs, result);
  return result;
}

function validateQuestionAndBundle(question, questionBytes, evidenceBundle, evidenceBundleBytes) {
  if (question.kind !== "visual-synthetic-question"
    || evidenceBundle.kind !== "problem-evidence-bundle"
    || question.subjectPack !== evidenceBundle.subjectPack
    || question.questionId !== evidenceBundle.questionId
    || question.questionRef !== evidenceBundle.questionRef
    || evidenceBundle.questionBinding?.status !== "stable"
    || evidenceBundle.questionBinding.questionAuthoritySha256 !== sha256(questionBytes)) {
    throw new Error("question and evidence bundle binding drifted");
  }
  assertSchema(evidenceBundle, problemEvidenceBundleSchemaPath, "problem evidence bundle");
  if (sha256(evidenceBundleBytes).length !== 64) {
    throw new Error("problem evidence bundle hash is invalid");
  }
}

function validateRequestBindings(context) {
  const { question, questionBytes, evidenceBundle, evidenceBundleBytes, tracks, request } = context;
  if (request.subjectPack !== question.subjectPack
    || request.fixtureKind !== "synthetic_fixture"
    || request.question.rawByteSha256 !== sha256(questionBytes)
    || request.question.questionId !== question.questionId
    || request.question.questionRef !== question.questionRef
    || request.evidenceBundle.rawByteSha256 !== sha256(evidenceBundleBytes)
    || request.evidenceBundle.evidenceBundleId !== evidenceBundle.evidenceBundleId
    || request.orchestrationPolicySha256 !== orchestrationPolicySha256()
    || JSON.stringify(request.dispositions) !== JSON.stringify(requestDispositions())) {
    throw new Error("orchestration request input binding drifted");
  }
  if (JSON.stringify(request.expectedTrackTypes) !== JSON.stringify(EXPECTED_TRACK_TYPES)) {
    throw new Error("orchestration request expected track types drifted");
  }
  if (request.tracks.length !== tracks.length) {
    throw new Error("orchestration request track inventory drifted");
  }
  const seenTypes = new Set();
  const seenIds = new Set();
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const binding = request.tracks[index];
    assertSchema(track.value, trackResultSchemaPath, `${track.value.trackType} TrackResult`);
    if (binding.artifactRef !== track.artifactRef
      || binding.rawByteSha256 !== sha256(track.bytes)
      || binding.trackType !== track.value.trackType
      || binding.trackResultId !== track.value.trackResultId) {
      throw new Error("orchestration request TrackResult binding drifted");
    }
    if (seenTypes.has(track.value.trackType) || seenIds.has(track.value.trackResultId)) {
      throw new Error("orchestration source tracks must have unique types and ids");
    }
    seenTypes.add(track.value.trackType);
    seenIds.add(track.value.trackResultId);
    const questionBinding = track.value.questionBinding;
    if (track.value.evidenceBundleRef !== evidenceBundle.evidenceBundleId
      || questionBinding?.status !== "exact"
      || questionBinding.questionId !== question.questionId
      || questionBinding.questionRef !== question.questionRef
      || questionBinding.questionAuthoritySha256 !== sha256(questionBytes)
      || questionBinding.evidenceBundleRef !== evidenceBundle.evidenceBundleId) {
      throw new Error(`${track.value.trackType} question binding drifted`);
    }
  }
}

function compareCandidateTracks(trackResults) {
  const candidates = trackResults
    .filter((track) => track.trackType !== "rule_validator")
    .map((track) => ({
      trackType: track.trackType,
      trackResultId: track.trackResultId,
      normalized: normalizeAnswerCandidate(track.answerCandidate)
    }))
    .filter((candidate) => candidate.normalized.length > 0);
  if (candidates.length < 2) {
    return { status: "not_comparable", candidateTrackTypes: candidates.map((item) => item.trackType), conflictRefs: [] };
  }
  const normalized = new Set(candidates.map((candidate) => candidate.normalized));
  if (normalized.size === 1) {
    return {
      status: "agreement",
      normalizedCandidate: candidates[0].normalized,
      candidateTrackTypes: candidates.map((item) => item.trackType),
      conflictRefs: []
    };
  }
  return {
    status: "conflict",
    candidateTrackTypes: candidates.map((item) => item.trackType),
    conflictRefs: candidates.map((item) => item.trackResultId)
  };
}

function compileTrackCDisposition(trackResults) {
  const trackC = trackResults.find((track) => track.trackType === "rule_validator");
  if (!trackC) {
    return { status: "missing", blockingFindingRefs: [] };
  }
  const findings = blockingFindings(trackC).map(
    (finding) => `${trackC.trackResultId}:${finding.findingId}`
  );
  return { status: findings.length > 0 ? "blocking" : "pass", blockingFindingRefs: findings };
}

function blockingFindings(trackResult) {
  return (trackResult.validatorFindings ?? []).filter((finding) => finding.severity === "blocking");
}

function compileCanonicalArtifacts() {
  const references = canonicalReferences();
  const question = readAuthority(path.join(upstreamRoot, path.basename(references.question)));
  const evidenceBundle = readAuthority(path.join(upstreamRoot, path.basename(references.evidenceBundle)));
  const trackB = readAuthority(path.join(upstreamRoot, path.basename(references.trackB)));
  const trackC = readAuthority(path.join(trackCRoot, path.basename(references.trackC)));
  const trackAValue = buildSyntheticTrackA({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    generatedAt: canonicalTimes.trackA
  });
  const trackA = { value: trackAValue, bytes: stableJsonBytes(trackAValue), artifactRef: references.trackA };
  const tracks = [
    trackA,
    { ...trackB, artifactRef: references.trackB },
    { ...trackC, artifactRef: references.trackC }
  ];
  const request = buildOrchestrationRequest({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    tracks,
    requestedAt: canonicalTimes.request,
    references
  });
  const requestBytes = stableJsonBytes(request);
  const result = orchestrateTracks({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    tracks,
    request,
    requestBytes,
    generatedAt: canonicalTimes.result
  });
  return [
    artifact(path.basename(references.trackA), trackA.value, trackResultSchemaPath),
    artifact(path.basename(references.request), request, requestSchemaPath),
    artifact(path.basename(references.report), result.report, reportSchemaPath),
    artifact(path.basename(references.decisionRecord), result.decisionRecord, null)
  ];
}

function canonicalReferences() {
  return {
    question: "eval/ocr-layout-solver/cases/junior-readable-measurement.visual-synthetic-question.json",
    evidenceBundle: "eval/ocr-layout-solver/cases/junior-readable-measurement.problem-evidence-bundle.json",
    trackA: "eval/track-orchestration/cases/junior-readable-measurement.track-a.json",
    trackB: "eval/ocr-layout-solver/cases/junior-readable-measurement.track-b.json",
    trackC: "eval/synthetic-track-validator/cases/junior-readable-measurement.track-c.json",
    request: "eval/track-orchestration/cases/junior-readable-measurement.track-orchestration-request.json",
    report: "eval/track-orchestration/cases/junior-readable-measurement.track-orchestration-report.json",
    decisionRecord: "eval/track-orchestration/cases/junior-readable-measurement.decision-record.json"
  };
}

function requestDispositions() {
  return {
    scope: "public_synthetic_track_orchestration",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function resultDispositions() {
  return {
    scope: "public_synthetic_track_orchestration",
    orchestrationDisposition: "orchestrated_not_accepted",
    requiresHumanReview: true,
    deliveryTrustDisposition: "not_projected",
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function reviewDisposition(reasonCode) {
  return {
    status: "review_required",
    reasonCodes: [reasonCode, "acceptance_tier_unverified"],
    humanApproved: false,
    trusted: false,
    visualReviewPassed: null,
    controlsDisposition: "not_verified",
    eligible: false,
    optimizationCandidateRefs: []
  };
}

function artifactBinding(artifactRef, bytes, identity) {
  return { artifactRef, rawByteSha256: sha256(bytes), ...identity };
}

function admittedBinding(binding) {
  return {
    artifactRef: binding.artifactRef,
    rawByteSha256: binding.rawByteSha256,
    admissionStatus: "admitted"
  };
}

function artifact(name, value, schemaPath) {
  return { name, value, bytes: stableJsonBytes(value), schemaPath };
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

function assertSchema(value, schemaPath, label) {
  if (!schemaPath) {
    const errors = validateDecisionRecord(value);
    if (errors.length > 0) {
      throw new Error(`${label} failed schema validation: ${errors.join("; ")}`);
    }
    return;
  }
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} failed schema validation: ${errors.join("; ")}`);
  }
}

function readAuthority(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { value: JSON.parse(bytes.toString("utf8")), bytes };
}

function loadBoundArtifact(binding, label) {
  const artifactPath = resolveRepoArtifactRef(binding.artifactRef, label);
  const authority = readAuthority(artifactPath);
  if (sha256(authority.bytes) !== binding.rawByteSha256) {
    throw new Error(`${label} raw bytes drifted`);
  }
  return authority;
}

function resolveRepoArtifactRef(artifactRef, label) {
  if (typeof artifactRef !== "string"
    || artifactRef.includes("\\")
    || path.posix.isAbsolute(artifactRef)
    || path.posix.normalize(artifactRef) !== artifactRef
    || artifactRef.startsWith("../")) {
    throw new Error(`${label} artifactRef must be a normalized repository-relative path`);
  }
  return assertRepositoryFile(path.resolve(repoRoot, ...artifactRef.split("/")), label);
}

function assertRepositoryFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!isWithin(resolved, repoRoot) || !fs.existsSync(resolved)) {
    throw new Error(`${label} must exist inside repository authority`);
  }
  const physical = fs.realpathSync.native(resolved);
  const physicalRepo = fs.realpathSync.native(repoRoot);
  if (!isWithin(physical, physicalRepo) || !fs.statSync(physical).isFile()) {
    throw new Error(`${label} must resolve to a repository file`);
  }
  return resolved;
}

function toRepoRef(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function writeOutputDirectory(outDir, outputs, result) {
  const resolved = path.resolve(outDir);
  if (fs.existsSync(resolved)) {
    throw new Error("runtime output directory already exists");
  }
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("runtime output parent must exist");
  }
  const physicalParent = fs.realpathSync.native(parent);
  const physicalRepo = fs.realpathSync.native(repoRoot);
  if (isWithin(resolved, repoRoot) || isWithin(physicalParent, physicalRepo)) {
    throw new Error("output must be outside repository authority");
  }
  const names = [path.basename(outputs.orchestrationReportRef), path.basename(outputs.decisionRecordRef)];
  if (new Set(names).size !== 2 || names.some((name) => !name.endsWith(".json"))) {
    throw new Error("runtime output artifact names are invalid");
  }
  const temporary = fs.mkdtempSync(path.join(parent, ".track-orchestrator-"));
  try {
    fs.writeFileSync(path.join(temporary, names[0]), stableJsonBytes(result.report), { flag: "wx" });
    fs.writeFileSync(path.join(temporary, names[1]), stableJsonBytes(result.decisionRecord), { flag: "wx" });
    fs.renameSync(temporary, resolved);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
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

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function usage() {
  return [
    "Usage:",
    "  node track-orchestrator.mjs materialize",
    "  node track-orchestrator.mjs validate",
    "  node track-orchestrator.mjs compile --request <repository-request> --out-dir <external-directory>"
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
    const result = compileRequest({
      requestPath: requireFlag(args, "--request"),
      outDir: requireFlag(args, "--out-dir")
    });
    console.log(JSON.stringify({
      orchestrationReportId: result.report.orchestrationReportId,
      decisionId: result.decisionRecord.decisionId
    }, null, 2));
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
