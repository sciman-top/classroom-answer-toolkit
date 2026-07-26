import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compileSampleRun,
  resolveContainedRef,
  validateCanonicalSampleAuthorities,
  validateSampleRunRecord
} from "./sample-run.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const indexPath = path.join(repoRoot, "样例交付", "index.json");
const fixtureRoot = path.join(
  repoRoot,
  "样例交付",
  "structured",
  "math-answer",
  "synthetic-linear-equation");
const packagePath = path.join(fixtureRoot, "sample.json");
const candidatePath = path.join(fixtureRoot, "candidate.negative-candidate.json");

test("plumbing records authority hashes without scoring or unsupported truth tier", () => {
  const record = compileSampleRun({
    sampleId: "synthetic-linear-equation",
    runMode: "plumbing",
    candidateSourceType: "reference_placeholder",
    truthExtractionStatus: "low_confidence",
    inputAnswerLeakage: "suspected_unresolved",
    iteration: 1
  });

  assert.equal(record.kind, "sample-run-record");
  assert.equal(record.runMode, "plumbing");
  assert.equal(record.candidateSourceType, "reference_placeholder");
  assert.match(record.sampleIndexSha256, /^[a-f0-9]{64}$/);
  assert.match(record.samplePackageSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.referenceTruthSource, undefined);
  assert.deepEqual(record.optimizationCandidateRefs, []);
  assert.equal(record.diffSummary, undefined);
  assert.equal(record.stopReason, "plumbing_only_no_scoring_or_optimization");
});

test("scoring records exact hash diff and fixture-labelled root cause", () => {
  const record = compileSampleRun(scoringOptions());

  assert.equal(record.runMode, "scoring");
  assert.equal(record.candidateSourceType, "perturbed_negative");
  assert.equal(record.diffSummary.method, "sha256_exact");
  assert.equal(record.diffSummary.exactMatch, false);
  assert.match(record.diffSummary.candidateSha256, /^[a-f0-9]{64}$/);
  assert.match(record.diffSummary.referenceSha256, /^[a-f0-9]{64}$/);
  assert.match(record.candidateDescriptorSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    record.candidateDescriptorRef,
    "structured/math-answer/synthetic-linear-equation/candidate.negative-candidate.json");
  assert.equal(record.rootCauseSummary.primaryErrorType, "reasoning_error");
  assert.equal(record.rootCauseSummary.expectedSeverity, "medium");
  assert.equal(record.rootCauseSummary.labelConfidence, 1);
  assert.equal(record.rootCauseSummary.labelSource, "negative_candidate_fixture");
  assert.deepEqual(record.optimizationCandidateRefs, []);
  assert.equal(record.stopReason, "scoring_recorded_no_optimizer");
});

test("generated scoring binds deterministic synthetic generation provenance", () => {
  const record = compileSampleRun(scoringOptions({
    candidatePath: path.join(
      fixtureRoot,
      "candidate.generated-arithmetic-slip.negative-candidate.json")
  }));

  assert.equal(record.candidateSourceType, "generated");
  assert.equal(record.diffSummary.exactMatch, false);
  assert.equal(record.rootCauseSummary.labelSource, "negative_candidate_fixture");
  assert.deepEqual(record.optimizationCandidateRefs, []);
});

test("all runs require explicit truth extraction status", () => {
  assert.throws(
    () => compileSampleRun(scoringOptions({ truthExtractionStatus: undefined })),
    /truthExtractionStatus is required/);
});

test("all runs require explicit input answer leakage status", () => {
  assert.throws(
    () => compileSampleRun(scoringOptions({ inputAnswerLeakage: undefined })),
    /inputAnswerLeakage is required/);
});

test("scoring rejects non-ok truth extraction", () => {
  assert.throws(
    () => compileSampleRun(scoringOptions({ truthExtractionStatus: "low_confidence" })),
    /truthExtractionStatus=ok/);
});

test("scoring rejects unresolved answer leakage", () => {
  assert.throws(
    () => compileSampleRun(scoringOptions({ inputAnswerLeakage: "suspected_unresolved" })),
    /suspected_unresolved/);
});

test("compiler rejects caller-controlled index and package authorities", () => {
  assert.throws(
    () => compileSampleRun(scoringOptions({ indexPath })),
    /canonical authorities/);
  assert.throws(
    () => compileSampleRun(scoringOptions({ packagePath })),
    /canonical authorities/);
});

test("canonical authority validator covers every indexed sample", () => {
  assert.equal(validateCanonicalSampleAuthorities(), 1);
});

test("sample and subject IDs must be single kebab-case path segments", () => {
  assert.throws(
    () => compileSampleRun({
      sampleId: "../synthetic-linear-equation",
      runMode: "plumbing",
      truthExtractionStatus: "ok",
      inputAnswerLeakage: "none"
    }),
    /kebab-case path segment/);

  const record = compileSampleRun({
    sampleId: "synthetic-linear-equation",
    runMode: "plumbing",
    truthExtractionStatus: "ok",
    inputAnswerLeakage: "none"
  });
  assert.throws(
    () => validateSampleRunRecord({ ...record, subjectPack: "math/answer" }),
    /subjectPack.*pattern/);
});

test("scoring rejects reference placeholders through semantic admission", () => {
  const record = compileSampleRun(scoringOptions());
  record.candidateSourceType = "reference_placeholder";
  assert.throws(
    () => validateSampleRunRecord(record),
    /admitted candidateSourceType/);
});

test("contained refs reject absolute and parent escapes", () => {
  assert.throws(
    () => resolveContainedRef(candidatePath, packagePath, fixtureRoot, "absolute ref"),
    /relative path/);
  assert.throws(
    () => resolveContainedRef("../../../index.json", packagePath, fixtureRoot, "parent ref"),
    /escapes its allowed root/);
});

test("contained refs reject symlink escapes when symlinks are available", (context) => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const allowedRoot = path.join(directory, "allowed");
    const outsidePath = path.join(directory, "outside.json");
    const ownerPath = path.join(allowedRoot, "owner.json");
    const linkPath = path.join(allowedRoot, "linked.json");
    fs.mkdirSync(allowedRoot);
    fs.writeFileSync(outsidePath, "{}");
    fs.writeFileSync(ownerPath, "{}");
    try {
      fs.symlinkSync(outsidePath, linkPath, "file");
    } catch (error) {
      skipOnlyForCapabilityError(context, "symlink", error);
      return;
    }
    try {
      assert.throws(
        () => resolveContainedRef(path.basename(linkPath), ownerPath, allowedRoot, "symlink ref"),
        /escapes its allowed root/);
    } finally {
      fs.rmSync(linkPath, { force: true });
    }
  });
});

test("semantic validator rejects malformed authority and run invariants", () => {
  const plumbing = compileSampleRun({
    sampleId: "synthetic-linear-equation",
    runMode: "plumbing",
    truthExtractionStatus: "ok",
    inputAnswerLeakage: "none",
    iteration: 1
  });

  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, sampleId: "" }),
    /sampleId.*pattern/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, subjectPack: "" }),
    /subjectPack.*pattern/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, iteration: 0 }),
    /iteration.*>= 1/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, sampleIndexSha256: "bad" }),
    /sampleIndexSha256.*pattern/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, diffSummary: {} }),
    /must not contain diff/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, optimizationCandidateRefs: ["future.json"] }),
    /must remain empty/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, referenceTruthSource: "L1" }),
    /not supported/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, sampleIndexSha256: "0".repeat(64) }),
    /current canonical authority/);
  assert.throws(
    () => validateSampleRunRecord({ ...plumbing, stopReason: "approved_for_optimization" }),
    /unsupported stopReason/);

  const scoring = compileSampleRun(scoringOptions());
  assert.throws(
    () => validateSampleRunRecord({ ...scoring, rootCauseSummary: {} }),
    /root-cause summary/);
  assert.throws(
    () => validateSampleRunRecord({
      ...scoring,
      diffSummary: { ...scoring.diffSummary, exactMatch: true }
    }),
    /must agree/);
  assert.throws(
    () => validateSampleRunRecord({
      ...scoring,
      diffSummary: {
        ...scoring.diffSummary,
        referenceSha256: scoring.diffSummary.candidateSha256,
        exactMatch: false
      }
    }),
    /must agree/);
  assert.throws(
    () => validateSampleRunRecord({
      ...scoring,
      candidateDescriptorSha256: "0".repeat(64)
    }),
    /current canonical authority/);
  assert.throws(
    () => validateSampleRunRecord({ ...scoring, stopReason: "approved_for_optimization" }),
    /unsupported stopReason/);
});

test("CLI atomically writes a shape-and-semantics-valid scoring record", () => {
  usingTemporaryDirectory((directory) => {
    const outputPath = path.join(directory, "scoring.sample-run-record.json");
    const result = runCli(outputPath);

    assert.equal(result.status, 0, result.stderr);
    const record = readJson(outputPath);
    assert.equal(record.kind, "sample-run-record");
    assert.equal(record.runMode, "scoring");
    assert.equal(record.diffSummary.exactMatch, false);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);
  });
});

test("CLI rejects removed index and package options", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "sample-run.mjs"), "--index", indexPath],
    { cwd: repoRoot, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --index/);
});

test("CLI rejects output path aliasing an input without modification", () => {
  const originalIndex = fs.readFileSync(indexPath);
  const result = runCli(indexPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not alias/);
  assert.deepEqual(fs.readFileSync(indexPath), originalIndex);
});

test("CLI rejects hardlink output aliasing an input when hardlinks are available", (context) => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const outputPath = path.join(directory, "hardlink-output.json");
    try {
      fs.linkSync(candidatePath, outputPath);
    } catch (error) {
      skipOnlyForCapabilityError(context, "hardlink", error);
      return;
    }
    const originalCandidate = fs.readFileSync(candidatePath);
    const result = runCli(outputPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not alias/);
    assert.deepEqual(fs.readFileSync(candidatePath), originalCandidate);
  });
});

function scoringOptions(overrides = {}) {
  return {
    sampleId: "synthetic-linear-equation",
    runMode: "scoring",
    candidatePath,
    truthExtractionStatus: "ok",
    inputAnswerLeakage: "none",
    iteration: 1,
    ...overrides
  };
}

function runCli(outputPath) {
  return spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "sample-run.mjs"),
      "--sample-id", "synthetic-linear-equation",
      "--run-mode", "scoring",
      "--candidate", candidatePath,
      "--truth-extraction-status", "ok",
      "--input-answer-leakage", "none",
      "--iteration", "1",
      "--out", outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function skipOnlyForCapabilityError(context, capability, error) {
  if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
    context.skip(`${capability} unavailable: ${error.code}`);
    return;
  }
  throw error;
}

function usingTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-flywheel-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function usingSameVolumeTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(
    path.join(path.parse(repoRoot).root, "classroom-toolkit-flywheel-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
