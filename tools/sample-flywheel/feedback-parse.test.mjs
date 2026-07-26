import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compileFeedbackParseResult,
  validateFeedbackParseResult,
  validateFeedbackSourceAdmission
} from "./feedback-parse.mjs";
import { compileSampleRun } from "./sample-run.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const candidatePath = path.join(
  repoRoot,
  "样例交付",
  "structured",
  "math-answer",
  "synthetic-linear-equation",
  "candidate.negative-candidate.json");
const indexPath = path.join(repoRoot, "样例交付", "index.json");
const createdAt = "2026-07-26T12:00:00.000Z";

test("fixture-labelled scoring run compiles one attributed feedback record", () => {
  usingScoringRun(({ runPath }) => {
    const result = compileFeedbackParseResult({ runPath, createdAt });

    assert.equal(result.kind, "feedback-parse-result");
    assert.equal(result.parseMode, "synthetic_fixture_label");
    assert.equal(result.schemaVersion, "2.0");
    assert.equal(result.parseDisposition, "parsed");
    assert.match(result.sourceRunSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.feedbackRecords.length, 1);
    assert.equal(result.feedbackRecords[0].primaryErrorType, "reasoning_error");
    assert.deepEqual(result.feedbackRecords[0].contributingErrorTypes, []);
    assert.equal(result.feedbackRecords[0].confidence, 1);
    assert.equal(result.feedbackRecords[0].severity, "medium");
    assert.equal(result.feedbackRecords[0].createdAt, createdAt);
    assert.deepEqual(result.optimizationCandidateRefs, []);
    assert.equal(result.stopReason, "feedback_recorded_no_optimizer");
  });
});

test("feedback parsing rejects plumbing runs", () => {
  usingTemporaryDirectory((directory) => {
    const runPath = path.join(directory, "plumbing.sample-run-record.json");
    writeJson(runPath, compileSampleRun({
      sampleId: "synthetic-linear-equation",
      runMode: "plumbing",
      truthExtractionStatus: "ok",
      inputAnswerLeakage: "none",
      iteration: 1
    }));

    assert.throws(
      () => compileFeedbackParseResult({ runPath, createdAt }),
      /requires a scoring SampleRunRecord/);
  });
});

test("feedback parsing rejects invalid timestamps", () => {
  usingScoringRun(({ runPath }) => {
    assert.throws(
      () => compileFeedbackParseResult({ runPath, createdAt: "2026-07-26" }),
      /canonical UTC ISO-8601/);
  });
});

test("feedback admission rejects exact scoring and current-authority drift", () => {
  usingScoringRun(({ directory, run }) => {
    assert.throws(
      () => validateFeedbackSourceAdmission({
        ...run,
        diffSummary: {
          ...run.diffSummary,
          exactMatch: true,
          referenceSha256: run.diffSummary.candidateSha256
        },
        rootCauseSummary: { detected: false }
      }),
      /requires a non-exact scoring result/);

    for (const field of [
      "sampleIndexSha256",
      "samplePackageSha256",
      "candidateDescriptorSha256"
    ]) {
      const driftedRunPath = path.join(directory, `${field}.sample-run-record.json`);
      writeJson(driftedRunPath, { ...run, [field]: "0".repeat(64) });
      assert.throws(
        () => compileFeedbackParseResult({ runPath: driftedRunPath, createdAt }),
        /current canonical authority/);
    }
  });
});

test("feedback result validator rejects authority and attribution drift", () => {
  usingScoringRun(({ runPath }) => {
    const result = compileFeedbackParseResult({ runPath, createdAt });
    assert.throws(
      () => validateFeedbackParseResult({ ...result, schemaVersion: "1.0" }, runPath),
      /schema validation/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        sourceFeedbackId: "not-allowed-on-auto-result"
      }, runPath),
      /schema validation/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        feedbackRecords: [{
          ...result.feedbackRecords[0],
          source: "teacher_input"
        }]
      }, runPath),
      /schema validation/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        optimizationCandidateRefs: ["optimization.json"]
      }, runPath),
      /schema validation/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        sourceRunSha256: "0".repeat(64)
      }, runPath),
      /does not match source run bytes/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        feedbackRecords: [{
          ...result.feedbackRecords[0],
          confidence: 0.5
        }]
      }, runPath),
      /attribution does not match/);
    assert.throws(
      () => validateFeedbackParseResult({
        ...result,
        feedbackRecords: [{
          ...result.feedbackRecords[0],
          errorType: "format_error"
        }]
      }, runPath),
      /compatibility alias/);
  });
});

test("CLI writes a validated result without temporary residue", () => {
  usingScoringRun(({ directory, runPath }) => {
    const outputPath = path.join(directory, "feedback-parse-result.json");
    const result = runCli(runPath, outputPath);

    assert.equal(result.status, 0, result.stderr);
    const parsed = readJson(outputPath);
    validateFeedbackParseResult(parsed, runPath);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);
  });
});

test("CLI rejects direct and hardlink source aliases without modification", (context) => {
  usingScoringRun(({ directory, runPath }) => {
    const original = fs.readFileSync(runPath);
    const directResult = runCli(runPath, runPath);
    assert.notEqual(directResult.status, 0);
    assert.match(directResult.stderr, /must not alias/);
    assert.deepEqual(fs.readFileSync(runPath), original);

    const hardlinkPath = path.join(directory, "hardlink-output.json");
    try {
      fs.linkSync(runPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const hardlinkResult = runCli(runPath, hardlinkPath);
    assert.notEqual(hardlinkResult.status, 0);
    assert.match(hardlinkResult.stderr, /must not alias/);
    assert.deepEqual(fs.readFileSync(runPath), original);
  });
});

test("CLI cannot overwrite or hardlink-alias canonical sample authority", (context) => {
  usingScoringRun(({ runPath }) => {
    const originalIndex = fs.readFileSync(indexPath);
    const directResult = runCli(runPath, indexPath);
    assert.notEqual(directResult.status, 0);
    assert.match(directResult.stderr, /outside the canonical sample root/);
    assert.deepEqual(fs.readFileSync(indexPath), originalIndex);
  });

  usingSameVolumeTemporaryDirectory((directory) => {
    const runPath = path.join(directory, "scoring.sample-run-record.json");
    const run = compileScoringRun();
    writeJson(runPath, run);
    const hardlinkPath = path.join(directory, "authority-hardlink.json");
    try {
      fs.linkSync(indexPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const originalIndex = fs.readFileSync(indexPath);
    const result = runCli(runPath, hardlinkPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical sample authority/);
    assert.deepEqual(fs.readFileSync(indexPath), originalIndex);
  });
});

function usingScoringRun(action) {
  usingTemporaryDirectory((directory) => {
    const runPath = path.join(directory, "scoring.sample-run-record.json");
    const run = compileScoringRun();
    writeJson(runPath, run);
    action({ directory, runPath, run });
  });
}

function compileScoringRun() {
  return compileSampleRun({
    sampleId: "synthetic-linear-equation",
    runMode: "scoring",
    candidatePath,
    truthExtractionStatus: "ok",
    inputAnswerLeakage: "none",
    iteration: 1
  });
}

function runCli(runPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "feedback-parse.mjs"),
      "--run", runPath,
      "--created-at", createdAt,
      "--out", outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function usingTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-feedback-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function usingSameVolumeTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(
    path.join(path.parse(repoRoot).root, "classroom-toolkit-feedback-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
