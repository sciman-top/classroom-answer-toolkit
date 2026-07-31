import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildValidatorRequest,
  compileCanonicalRequest,
  compileValidation,
  stableJsonBytes,
  validateCanonicalFixtures
} from "./synthetic-track-validator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const canonicalRoot = path.join(repoRoot, "eval", "synthetic-track-validator", "cases");
const canonicalRequestPath = path.join(
  canonicalRoot,
  "junior-readable-measurement.synthetic-track-validator-request.json"
);

const authorityPaths = {
  question: path.join(
    repoRoot,
    "eval",
    "ocr-layout-solver",
    "cases",
    "junior-readable-measurement.visual-synthetic-question.json"
  ),
  evidenceBundle: path.join(
    repoRoot,
    "eval",
    "ocr-layout-solver",
    "cases",
    "junior-readable-measurement.problem-evidence-bundle.json"
  ),
  projection: path.join(
    repoRoot,
    "eval",
    "visual-semantic-projection",
    "cases",
    "junior-readable-measurement.visual-semantic-projection-result.json"
  ),
  solverRequest: path.join(
    repoRoot,
    "eval",
    "ocr-layout-solver",
    "cases",
    "junior-readable-measurement.ocr-layout-solver-request.json"
  ),
  trackB: path.join(
    repoRoot,
    "eval",
    "ocr-layout-solver",
    "cases",
    "junior-readable-measurement.track-b.json"
  )
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function canonicalContext(mutator) {
  const context = {
    question: readJson(authorityPaths.question),
    evidenceBundle: readJson(authorityPaths.evidenceBundle),
    projection: readJson(authorityPaths.projection),
    solverRequest: readJson(authorityPaths.solverRequest),
    trackB: readJson(authorityPaths.trackB)
  };
  mutator?.(context);
  context.questionBytes = stableJsonBytes(context.question);
  context.evidenceBundleBytes = stableJsonBytes(context.evidenceBundle);
  context.projectionBytes = stableJsonBytes(context.projection);
  context.solverRequestBytes = stableJsonBytes(context.solverRequest);
  context.trackBBytes = stableJsonBytes(context.trackB);
  context.request = buildValidatorRequest({
    ...context,
    requestedAt: "2026-07-30T01:00:00Z"
  });
  return context;
}

function failedCheck(result, checkId) {
  return result.consistencyReport.checks.find((check) => check.checkId === checkId);
}

test("compileValidation emits seven passing checks while preserving review-required state", () => {
  const result = compileValidation({
    ...canonicalContext(),
    generatedAt: "2026-07-30T01:00:01Z"
  });

  assert.equal(result.consistencyReport.kind, "consistency-report");
  assert.equal(result.consistencyReport.checks.length, 7);
  assert.ok(result.consistencyReport.checks.every((check) => check.status === "pass"));
  assert.equal(result.consistencyReport.groundingSufficient, true);
  assert.deepEqual(result.consistencyReport.recommendedDecisionReasons, ["acceptance_tier_unverified"]);
  assert.equal(result.trackResult.trackType, "rule_validator");
  assert.equal(result.trackResult.answerCandidate, "validated: 12 cm");
  assert.deepEqual(result.trackResult.validatorFindings, []);
  assert.equal(result.trackResult.reviewDisposition.status, "review_required");
  assert.equal(result.trackResult.reviewDisposition.humanApproved, false);
  assert.equal(result.trackResult.reviewDisposition.trusted, false);
  assert.equal(result.trackResult.reviewDisposition.visualReviewPassed, null);
  assert.equal(result.trackResult.reviewDisposition.controlsDisposition, "not_verified");
  assert.equal(result.trackResult.reviewDisposition.eligible, false);
  assert.deepEqual(result.trackResult.reviewDisposition.optimizationCandidateRefs, []);
});

test("question and evidence binding mismatches compile blocking findings", () => {
  const questionMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.questionBinding.questionRef = "SYN-JP-MEAS-999";
  }));
  assert.equal(failedCheck(questionMismatch, "question_binding_exact").status, "blocking");

  const evidenceMismatch = compileValidation(canonicalContext(({ evidenceBundle }) => {
    evidenceBundle.questionBinding.questionAuthoritySha256 = "f".repeat(64);
  }));
  assert.equal(failedCheck(evidenceMismatch, "question_binding_exact").status, "blocking");
});

test("quantity and explicit unit mismatches compile blocking findings", () => {
  const quantityMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.interpretation.quantityKind = "mass";
  }));
  assert.equal(failedCheck(quantityMismatch, "quantity_binding_exact").status, "blocking");

  const unitMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.interpretation.unitSymbol = "m";
  }));
  assert.equal(failedCheck(unitMismatch, "unit_binding_exact").status, "blocking");

  const missingToken = compileValidation(canonicalContext(({ question }) => {
    question.promptText = "What is the displayed reading?";
  }));
  assert.equal(failedCheck(missingToken, "unit_binding_exact").status, "blocking");
});

test("numeric and answer format mismatches compile blocking findings", () => {
  const numericMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.interpretation.numericValue = "twelve";
    trackB.answerCandidate = "twelve cm";
  }));
  assert.equal(failedCheck(numericMismatch, "numeric_format_valid").status, "blocking");

  const answerMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.answerCandidate = "12cm";
  }));
  assert.equal(failedCheck(answerMismatch, "answer_format_exact").status, "blocking");
});

test("semantic evidence and review boundary mismatches compile blocking findings", () => {
  const evidenceMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.answerCandidateProvenance.semanticProjectionSha256 = "e".repeat(64);
  }));
  assert.equal(failedCheck(evidenceMismatch, "semantic_evidence_exact").status, "blocking");

  const reviewMismatch = compileValidation(canonicalContext(({ trackB }) => {
    trackB.reviewDisposition.trusted = true;
  }));
  assert.equal(failedCheck(reviewMismatch, "review_boundary_preserved").status, "blocking");
  assert.ok(reviewMismatch.consistencyReport.recommendedDecisionReasons.includes("rule_validator_failed"));
  assert.ok(reviewMismatch.trackResult.validatorFindings.some((finding) => finding.severity === "blocking"));
});

test("stale request hashes are rejected rather than compiled as semantic findings", () => {
  const context = canonicalContext();
  context.trackB.answerCandidate = "12cm";
  context.trackBBytes = stableJsonBytes(context.trackB);

  assert.throws(
    () => compileValidation(context),
    /validator request input binding drifted/
  );
});

test("request artifact reference drift is rejected", () => {
  const inputDrift = canonicalContext();
  inputDrift.request.inputs.trackB.artifactRef = "eval/copied-track-b.json";
  assert.throws(
    () => compileValidation(inputDrift),
    /validator request artifact reference drifted/
  );

  const outputDrift = canonicalContext();
  outputDrift.request.outputs.consistencyReportRef = "eval/copied-consistency-report.json";
  assert.throws(
    () => compileValidation(outputDrift),
    /validator request artifact reference drifted/
  );
});

test("canonical fixtures replay byte-exactly and compile to one external atomic directory", () => {
  assert.equal(validateCanonicalFixtures().length, 3);
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-track-validator-"));
  const outputDir = path.join(outputParent, "result");
  try {
    const result = compileCanonicalRequest({ requestPath: canonicalRequestPath, outDir: outputDir });
    assert.equal(result.trackResult.trackType, "rule_validator");
    assert.deepEqual(fs.readdirSync(outputDir).sort(), [
      "junior-readable-measurement.consistency-report.json",
      "junior-readable-measurement.track-c.json"
    ]);
    assert.deepEqual(
      readJson(path.join(outputDir, "junior-readable-measurement.track-c.json")),
      result.trackResult
    );
  } finally {
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test("runtime rejects non-canonical requests, repository output, and existing output", () => {
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-track-validator-"));
  try {
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: path.join(outputParent, "copied-request.json"),
        outDir: path.join(outputParent, "result")
      }),
      /only the canonical synthetic Track C validator request/
    );
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: canonicalRequestPath,
        outDir: path.join(repoRoot, "track-c-output")
      }),
      /output must be outside repository authority/
    );
    const existingOutput = path.join(outputParent, "existing");
    fs.mkdirSync(existingOutput);
    assert.throws(
      () => compileCanonicalRequest({ requestPath: canonicalRequestPath, outDir: existingOutput }),
      /runtime output directory already exists/
    );
    assert.deepEqual(fs.readdirSync(existingOutput), []);
  } finally {
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test("runtime rejects an external junction that resolves into repository authority", () => {
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-track-validator-junction-"));
  const junctionPath = path.join(outputParent, "repo-authority");
  const outputName = `.synthetic-track-validator-${process.pid}-${Date.now()}`;
  const repositoryOutput = path.join(repoRoot, outputName);
  try {
    fs.symlinkSync(repoRoot, junctionPath, "junction");
    assert.throws(
      () => compileCanonicalRequest({
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
