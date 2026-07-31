import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOrchestrationRequest,
  buildSyntheticTrackA,
  compileRequest,
  materializeCanonicalFixtures,
  orchestrateTracks,
  stableJsonBytes,
  validateCanonicalFixtures
} from "./track-orchestrator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const canonicalRequestPath = path.join(
  repoRoot,
  "eval",
  "track-orchestration",
  "cases",
  "junior-readable-measurement.track-orchestration-request.json"
);

function readAuthority(relativePath) {
  const bytes = fs.readFileSync(path.join(repoRoot, relativePath));
  return { value: JSON.parse(bytes.toString("utf8")), bytes, artifactRef: relativePath };
}

function fixture() {
  const question = readAuthority(
    "eval/ocr-layout-solver/cases/junior-readable-measurement.visual-synthetic-question.json"
  );
  const evidenceBundle = readAuthority(
    "eval/ocr-layout-solver/cases/junior-readable-measurement.problem-evidence-bundle.json"
  );
  const trackB = readAuthority(
    "eval/ocr-layout-solver/cases/junior-readable-measurement.track-b.json"
  );
  const trackC = readAuthority(
    "eval/synthetic-track-validator/cases/junior-readable-measurement.track-c.json"
  );
  const trackAValue = buildSyntheticTrackA({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    generatedAt: "2026-07-30T04:00:00Z"
  });
  const trackA = {
    value: trackAValue,
    bytes: stableJsonBytes(trackAValue),
    artifactRef: "eval/track-orchestration/cases/junior-readable-measurement.track-a.json"
  };
  const tracks = [trackA, trackB, trackC];
  const request = buildOrchestrationRequest({
    question: question.value,
    questionBytes: question.bytes,
    evidenceBundle: evidenceBundle.value,
    evidenceBundleBytes: evidenceBundle.bytes,
    tracks,
    requestedAt: "2026-07-30T04:00:01Z"
  });
  return { question, evidenceBundle, tracks, request, requestBytes: stableJsonBytes(request) };
}

function rebindRequest(context) {
  context.request = buildOrchestrationRequest({
    question: context.question.value,
    questionBytes: context.question.bytes,
    evidenceBundle: context.evidenceBundle.value,
    evidenceBundleBytes: context.evidenceBundle.bytes,
    tracks: context.tracks,
    requestedAt: "2026-07-30T04:00:01Z"
  });
  context.requestBytes = stableJsonBytes(context.request);
  return context;
}

function orchestrate(context) {
  return orchestrateTracks({
    question: context.question.value,
    questionBytes: context.question.bytes,
    evidenceBundle: context.evidenceBundle.value,
    evidenceBundleBytes: context.evidenceBundle.bytes,
    tracks: context.tracks,
    request: context.request,
    requestBytes: context.requestBytes,
    generatedAt: "2026-07-30T04:00:02Z"
  });
}

test("orchestrator admits exact Track A/B/C bytes and delegates a fail-closed DecisionRecord", () => {
  const result = orchestrate(fixture());

  assert.deepEqual(result.report.presentTrackTypes, [
    "vlm_direct",
    "ocr_layout_solver",
    "rule_validator"
  ]);
  assert.deepEqual(result.report.missingTrackTypes, []);
  assert.equal(result.report.comparison.status, "agreement");
  assert.equal(result.report.comparison.normalizedCandidate, "12 cm");
  assert.equal(result.report.trackCDisposition.status, "pass");
  assert.deepEqual(result.report.sourceBlockingFindingRefs, [
    "track-b-junior-readable-measurement-synthetic:synthetic_track_b_requires_review"
  ]);
  assert.equal(result.report.decisionCompiler.implementationRef, "tools/visual-evidence/decision-record.mjs");
  assert.equal(result.decisionRecord.decision, "review_required");
  assert.equal(result.decisionRecord.trusted, false);
  assert.equal(result.decisionRecord.visualReviewPassed, null);
  assert.ok(result.decisionRecord.decisionReasons.includes("dual_track_match"));
  assert.ok(result.decisionRecord.decisionReasons.includes("rule_validator_failed"));
  assert.ok(result.decisionRecord.decisionReasons.includes("acceptance_tier_unverified"));
});

test("orchestrator records a normalized Track A/B conflict", () => {
  const context = fixture();
  context.tracks[0].value.answerCandidate = "13 cm";
  context.tracks[0].value.interpretation.numericValue = "13";
  context.tracks[0].bytes = stableJsonBytes(context.tracks[0].value);
  rebindRequest(context);

  const result = orchestrate(context);

  assert.equal(result.report.comparison.status, "conflict");
  assert.deepEqual(result.report.comparison.conflictRefs, [
    "track-a-junior-readable-measurement-synthetic",
    "track-b-junior-readable-measurement-synthetic"
  ]);
  assert.ok(result.decisionRecord.decisionReasons.includes("dual_track_conflict"));
  assert.equal(result.decisionRecord.trusted, false);
});

test("orchestrator records missing Track A as explicit degradation and compiler evidence loss", () => {
  const context = fixture();
  context.tracks = context.tracks.filter((track) => track.value.trackType !== "vlm_direct");
  rebindRequest(context);

  const result = orchestrate(context);

  assert.equal(result.report.orchestrationStatus, "degraded");
  assert.equal(result.report.comparison.status, "not_comparable");
  assert.deepEqual(result.report.missingTrackTypes, ["vlm_direct"]);
  assert.ok(result.decisionRecord.decisionReasons.includes("evidence_chain_missing"));
  assert.equal(result.decisionRecord.trusted, false);
});

test("orchestrator preserves A/B agreement while missing Track C degrades the run", () => {
  const context = fixture();
  context.tracks = context.tracks.filter((track) => track.value.trackType !== "rule_validator");
  rebindRequest(context);

  const result = orchestrate(context);

  assert.equal(result.report.orchestrationStatus, "degraded");
  assert.equal(result.report.comparison.status, "agreement");
  assert.deepEqual(result.report.missingTrackTypes, ["rule_validator"]);
  assert.equal(result.report.trackCDisposition.status, "missing");
  assert.ok(result.decisionRecord.decisionReasons.includes("evidence_chain_missing"));
});

test("orchestrator preserves Track C blocking findings", () => {
  const context = fixture();
  const trackC = context.tracks.find((track) => track.value.trackType === "rule_validator");
  trackC.value.validatorFindings = [{
    findingId: "unit_binding_exact",
    severity: "blocking",
    message: "Synthetic mutation blocked the candidate.",
    evidenceRef: trackC.value.evidenceBundleRef
  }];
  trackC.bytes = stableJsonBytes(trackC.value);
  rebindRequest(context);

  const result = orchestrate(context);

  assert.equal(result.report.trackCDisposition.status, "blocking");
  assert.deepEqual(result.report.trackCDisposition.blockingFindingRefs, [
    "track-c-junior-readable-measurement-synthetic:unit_binding_exact"
  ]);
  assert.ok(result.decisionRecord.decisionReasons.includes("rule_validator_failed"));
});

test("orchestrator rejects raw-byte drift after request binding", () => {
  const context = fixture();
  context.tracks[0].value.visibleEvidenceSummary += " drift";
  context.tracks[0].bytes = stableJsonBytes(context.tracks[0].value);

  assert.throws(() => orchestrate(context), /TrackResult binding drifted/);
});

test("orchestrator rejects cross-question and duplicate-track bindings", () => {
  const crossQuestion = fixture();
  crossQuestion.tracks[0].value.questionBinding.questionRef = "SYN-JP-MEAS-999";
  crossQuestion.tracks[0].bytes = stableJsonBytes(crossQuestion.tracks[0].value);
  rebindRequest(crossQuestion);
  assert.throws(() => orchestrate(crossQuestion), /question binding drifted/);

  const duplicate = fixture();
  duplicate.tracks[1].value.trackType = "vlm_direct";
  duplicate.tracks[1].bytes = stableJsonBytes(duplicate.tracks[1].value);
  rebindRequest(duplicate);
  assert.throws(() => orchestrate(duplicate), /unique types and ids/);
});

test("orchestrator rejects a request that shrinks the required A/B/C set", () => {
  const context = fixture();
  context.request.expectedTrackTypes = ["ocr_layout_solver", "rule_validator"];
  context.requestBytes = stableJsonBytes(context.request);

  assert.throws(() => orchestrate(context), /expected track types drifted/);
});

test("canonical fixtures replay byte-exactly and runtime writes two artifacts atomically", () => {
  assert.equal(materializeCanonicalFixtures().length, 4);
  assert.equal(validateCanonicalFixtures().length, 4);
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "track-orchestrator-"));
  const outputDir = path.join(outputParent, "result");
  try {
    const result = compileRequest({ requestPath: canonicalRequestPath, outDir: outputDir });
    assert.deepEqual(fs.readdirSync(outputDir).sort(), [
      "junior-readable-measurement.decision-record.json",
      "junior-readable-measurement.track-orchestration-report.json"
    ]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(outputDir, "junior-readable-measurement.decision-record.json"))),
      result.decisionRecord
    );
  } finally {
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test("runtime rejects an external request, repository output, and existing output", () => {
  materializeCanonicalFixtures();
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "track-orchestrator-"));
  try {
    const copiedRequest = path.join(outputParent, "request.json");
    fs.copyFileSync(canonicalRequestPath, copiedRequest);
    assert.throws(
      () => compileRequest({ requestPath: copiedRequest, outDir: path.join(outputParent, "external") }),
      /must exist inside repository authority/
    );
    assert.throws(
      () => compileRequest({
        requestPath: canonicalRequestPath,
        outDir: path.join(repoRoot, ".track-orchestrator-output")
      }),
      /output must be outside repository authority/
    );
    const existingOutput = path.join(outputParent, "existing");
    fs.mkdirSync(existingOutput);
    assert.throws(
      () => compileRequest({ requestPath: canonicalRequestPath, outDir: existingOutput }),
      /output directory already exists/
    );
    assert.deepEqual(fs.readdirSync(existingOutput), []);
  } finally {
    fs.rmSync(path.join(repoRoot, ".track-orchestrator-output"), { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test("runtime rejects an external junction that resolves into repository authority", () => {
  materializeCanonicalFixtures();
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "track-orchestrator-junction-"));
  const junctionPath = path.join(outputParent, "repo-authority");
  const outputName = `.track-orchestrator-${process.pid}-${Date.now()}`;
  const repositoryOutput = path.join(repoRoot, outputName);
  try {
    fs.symlinkSync(repoRoot, junctionPath, "junction");
    assert.throws(
      () => compileRequest({
        requestPath: canonicalRequestPath,
        outDir: path.join(junctionPath, outputName)
      }),
      /output must be outside repository authority/
    );
    assert.equal(fs.existsSync(repositoryOutput), false);
  } finally {
    fs.rmSync(repositoryOutput, { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});
