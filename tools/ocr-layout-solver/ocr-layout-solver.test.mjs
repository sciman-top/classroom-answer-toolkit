import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProblemEvidenceBundle,
  buildSolverRequest,
  compileCanonicalRequest,
  compileTrackResult,
  stableJsonBytes,
  validateCanonicalFixtures
} from "./ocr-layout-solver.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const canonicalRequestPath = path.join(
  repoRoot,
  "eval",
  "ocr-layout-solver",
  "cases",
  "junior-readable-measurement.ocr-layout-solver-request.json"
);

const sha = (character) => character.repeat(64);

function authorities() {
  const question = {
    schemaVersion: "1.0",
    kind: "visual-synthetic-question",
    questionId: "synthetic-question-junior-readable-measurement-001",
    questionRef: "SYN-JP-MEAS-001",
    caseId: "junior-readable-measurement",
    subjectPack: "junior-physics-answer",
    fixtureKind: "synthetic_fixture",
    promptText: "The displayed length is measured in centimetres. What is the reading?",
    figureBinding: {
      cropRef: "junior-readable-measurement.crop-2x.png",
      cropRawByteSha256: sha("a"),
      cropDecodedRgbPixelSha256: sha("b")
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
    generatedAt: "2026-07-29T10:00:00Z"
  };
  const projection = {
    schemaVersion: "1.0",
    kind: "visual-semantic-projection-result",
    requestId: "junior-readable-measurement-semantic-projection",
    subjectPack: "junior-physics-answer",
    fixtureKind: "synthetic_fixture",
    crop: {
      artifactRef: question.figureBinding.cropRef,
      rawByteSha256: question.figureBinding.cropRawByteSha256,
      decodedRgbPixelSha256: question.figureBinding.cropDecodedRgbPixelSha256
    },
    projections: [{
      projectionId: "semantic-projection-001",
      semanticRole: "measurement_reading",
      recognizedText: "12"
    }],
    dispositions: {
      semanticStatus: "projected",
      requiresHumanReview: true,
      trackDisposition: "not_integrated",
      controlsDisposition: "not_verified",
      eligible: false
    },
    engineProvenance: { liveProvider: false, cloudEgress: false }
  };
  return { question, projection };
}

function compileFixture() {
  const { question, projection } = authorities();
  const questionBytes = stableJsonBytes(question);
  const projectionBytes = stableJsonBytes(projection);
  const evidenceBundle = buildProblemEvidenceBundle({
    question,
    questionBytes,
    projection,
    projectionBytes,
    generatedAt: "2026-07-29T10:00:01Z"
  });
  const evidenceBundleBytes = stableJsonBytes(evidenceBundle);
  const request = buildSolverRequest({
    question,
    questionBytes,
    projection,
    projectionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    requestedAt: "2026-07-29T10:00:02Z"
  });
  return {
    question,
    questionBytes,
    projection,
    projectionBytes,
    evidenceBundle,
    evidenceBundleBytes,
    request
  };
}

test("compileTrackResult binds the synthetic question, interpretation, solver, and candidate provenance", () => {
  const fixture = compileFixture();
  const result = compileTrackResult({ ...fixture, generatedAt: "2026-07-29T10:00:03Z" });

  assert.equal(result.kind, "track-result");
  assert.equal(result.trackType, "ocr_layout_solver");
  assert.equal(result.answerCandidate, "12 cm");
  assert.equal(result.questionBinding.status, "exact");
  assert.deepEqual(result.interpretation, {
    quantityKind: "length",
    numericValue: "12",
    unitId: "centimetre",
    unitSymbol: "cm",
    semanticRole: "measurement_reading",
    interpretationMode: "explicit_question_unit_plus_bound_ocr_numeric"
  });
  assert.equal(result.answerCandidateProvenance.sourceType, "deterministic_synthetic_solver");
  assert.equal(result.solverProvenance.liveProvider, false);
  assert.equal(result.reviewDisposition.status, "review_required");
  assert.equal(result.reviewDisposition.trusted, false);
  assert.equal(result.reviewDisposition.visualReviewPassed, null);
  assert.equal(result.reviewDisposition.controlsDisposition, "not_verified");
  assert.equal(result.reviewDisposition.eligible, false);
  assert.deepEqual(result.reviewDisposition.optimizationCandidateRefs, []);
  assert.equal(result.risk.reviewRequired, true);
});

test("compileTrackResult rejects question authority byte drift", () => {
  const fixture = compileFixture();
  fixture.question.promptText += " ";

  assert.throws(
    () => compileTrackResult(fixture),
    /question authority bytes drifted/
  );
});

test("compileTrackResult rejects a unit that is not explicit in the question", () => {
  const fixture = compileFixture();
  fixture.question.interpretationAuthority.unit.token = "metres";
  fixture.questionBytes = stableJsonBytes(fixture.question);

  assert.throws(
    () => compileTrackResult(fixture),
    /unit token is not explicit in the question/
  );
});

test("compileTrackResult rejects non-numeric projected text", () => {
  const fixture = compileFixture();
  fixture.projection.projections[0].recognizedText = "twelve";
  fixture.projectionBytes = stableJsonBytes(fixture.projection);

  assert.throws(
    () => compileTrackResult(fixture),
    /recognized text is not an admitted decimal number/
  );
});

test("compileTrackResult rejects a projection role outside the question authority", () => {
  const fixture = compileFixture();
  fixture.projection.projections[0].semanticRole = "axis_label";
  fixture.projectionBytes = stableJsonBytes(fixture.projection);

  assert.throws(
    () => compileTrackResult(fixture),
    /semantic role does not satisfy the question authority/
  );
});

test("compileTrackResult rejects an evidence bundle that no longer binds the request", () => {
  const fixture = compileFixture();
  fixture.evidenceBundle.questionRef = "SYN-JP-MEAS-999";
  fixture.evidenceBundleBytes = stableJsonBytes(fixture.evidenceBundle);

  assert.throws(
    () => compileTrackResult(fixture),
    /question binding drifted across solver authorities/
  );
});

test("compileTrackResult rejects stale question and projection hashes inside the evidence bundle", () => {
  const staleQuestion = compileFixture();
  staleQuestion.evidenceBundle.questionBinding.questionAuthoritySha256 = sha("f");
  staleQuestion.evidenceBundleBytes = stableJsonBytes(staleQuestion.evidenceBundle);
  assert.throws(
    () => compileTrackResult(staleQuestion),
    /question authority hash drifted in the evidence bundle/
  );

  const staleProjection = compileFixture();
  staleProjection.evidenceBundle.semanticEvidence.projectionResultSha256 = sha("e");
  staleProjection.evidenceBundleBytes = stableJsonBytes(staleProjection.evidenceBundle);
  assert.throws(
    () => compileTrackResult(staleProjection),
    /semantic projection hash drifted in the evidence bundle/
  );
});

test("compileTrackResult rejects expected interpretation or review disposition drift", () => {
  const interpretationDrift = compileFixture();
  interpretationDrift.request.expectedInterpretation.unitSymbol = "m";
  assert.throws(
    () => compileTrackResult(interpretationDrift),
    /solver request expected interpretation drifted/
  );

  const reviewDrift = compileFixture();
  reviewDrift.request.dispositions.optimizationCandidateRefs.push("candidate-not-allowed");
  assert.throws(
    () => compileTrackResult(reviewDrift),
    /solver request review disposition drifted/
  );
});

test("canonical fixtures replay byte-exactly and compile to an external atomic output", () => {
  assert.equal(validateCanonicalFixtures().length, 4);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-layout-solver-"));
  const outputPath = path.join(outputRoot, "track-b.json");
  try {
    const result = compileCanonicalRequest({
      requestPath: canonicalRequestPath,
      outPath: outputPath
    });
    assert.equal(result.answerCandidate, "12 cm");
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), result);
    assert.deepEqual(fs.readdirSync(outputRoot), ["track-b.json"]);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("runtime rejects non-canonical requests and repository outputs", () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-layout-solver-"));
  try {
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: path.join(outputRoot, "copied-request.json"),
        outPath: path.join(outputRoot, "track-b.json")
      }),
      /only the canonical OCR layout solver request/
    );
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: canonicalRequestPath,
        outPath: path.join(repoRoot, "track-b.json")
      }),
      /output must be outside repository authority/
    );
    const existingOutput = path.join(outputRoot, "existing-track-b.json");
    fs.writeFileSync(existingOutput, "preserve");
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: canonicalRequestPath,
        outPath: existingOutput
      }),
      /runtime output already exists/
    );
    assert.equal(fs.readFileSync(existingOutput, "utf8"), "preserve");
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("runtime rejects an external junction that resolves into repository authority", () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-layout-solver-junction-"));
  const junctionPath = path.join(outputRoot, "repo-authority");
  const outputName = `.ocr-layout-solver-junction-${process.pid}-${Date.now()}.json`;
  const repositoryOutput = path.join(repoRoot, outputName);
  try {
    fs.symlinkSync(repoRoot, junctionPath, "junction");
    assert.throws(
      () => compileCanonicalRequest({
        requestPath: canonicalRequestPath,
        outPath: path.join(junctionPath, outputName)
      }),
      /output must be outside repository authority/
    );
    assert.equal(fs.existsSync(repositoryOutput), false);
  } finally {
    fs.rmSync(repositoryOutput, { force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
