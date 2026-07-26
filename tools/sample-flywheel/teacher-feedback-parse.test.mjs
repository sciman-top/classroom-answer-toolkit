import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  classifyTeacherText,
  compileTeacherFeedbackParseResult,
  validateCanonicalTeacherFeedbackFixtures,
  validateTeacherFeedbackSubmission,
  validateTeacherFeedbackParseResult
} from "./teacher-feedback-parse.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const fixtureRoot = path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-readiness");
const runPath = path.join(
  fixtureRoot,
  "generated-arithmetic-slip.sample-run-record.json");
const teacherFixtureRoot = path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-teacher-feedback");
const reasoningFeedbackPath = path.join(
  teacherFixtureRoot,
  "reasoning-medium.teacher-feedback-submission.json");

test("teacher text lexicon parses one reasoning error and one severity", () => {
  const result = compileTeacherFeedbackParseResult({
    runPath,
    feedbackPath: reasoningFeedbackPath
  });

  assert.equal(result.schemaVersion, "2.0");
  assert.equal(result.parseMode, "teacher_text_lexicon");
  assert.equal(result.parseDisposition, "parsed");
  assert.equal(result.feedbackRecords.length, 1);
  assert.equal(result.feedbackRecords[0].source, "teacher_input");
  assert.equal(result.feedbackRecords[0].primaryErrorType, "reasoning_error");
  assert.equal(result.feedbackRecords[0].severity, "medium");
  assert.equal(result.feedbackRecords[0].confidence, 0.9);
  assert.deepEqual(result.optimizationCandidateRefs, []);
  assert.equal(result.stopReason, "feedback_recorded_no_optimizer");
});

test("teacher text lexicon parses one format error and low severity", () => {
  const feedbackPath = path.join(
    teacherFixtureRoot,
    "format-low.teacher-feedback-submission.json");
  const sourceRunPath = path.join(
    fixtureRoot,
    "generated-format-omission.sample-run-record.json");
  const result = compileTeacherFeedbackParseResult({
    runPath: sourceRunPath,
    feedbackPath
  });
  assert.equal(result.parseDisposition, "parsed");
  assert.equal(result.feedbackRecords[0].primaryErrorType, "format_error");
  assert.equal(result.feedbackRecords[0].severity, "low");
});

test("ambiguous or missing signals enter needs_human_label", () => {
  for (const [text, reasonCode] of [
    ["推理错误并伴随格式错误，中严重度。", "ambiguous_error_signal"],
    ["答案需要复核，中严重度。", "missing_error_signal"],
    ["存在推理错误。", "missing_severity_signal"],
    ["存在推理错误，低严重度但也标注中严重度。", "ambiguous_severity_signal"],
    ["没有推理错误，中严重度。", "negated_error_signal"],
    ["not a reasoning error, medium severity", "negated_error_signal"]
  ]) {
    assert.equal(classifyTeacherText(text).reasonCode, reasonCode);
  }
});

test("teacher parser admits public synthetic fixtures only", () => {
  const submission = readJson(reasoningFeedbackPath);
  assert.throws(
    () => validateTeacherFeedbackSubmission({
      ...submission,
      dataClassification: { level: "restricted" }
    }, reasoningFeedbackPath, runPath),
    /public synthetic fixtures only/);
  assert.throws(
    () => validateTeacherFeedbackSubmission({
      ...submission,
      fixtureKind: "real_teacher_input"
    }, reasoningFeedbackPath, runPath),
    /schema validation/);
});

test("teacher compiler rejects caller-labelled synthetic files outside canonical authority", () => {
  usingSubmission("推理错误，中严重度。", ({ feedbackPath }) => {
    assert.throws(
      () => compileTeacherFeedbackParseResult({ runPath, feedbackPath }),
      /not admitted by canonical fixture authority/);
  });
});

test("teacher result validator rejects computed-field drift", () => {
  const result = compileTeacherFeedbackParseResult({
    runPath,
    feedbackPath: reasoningFeedbackPath
  });
  assert.throws(
    () => validateTeacherFeedbackParseResult({
      ...result,
      parseDisposition: "needs_human_label",
      humanQueue: "needs_human_label",
      reasonCode: "ambiguous_error_signal"
    }, runPath, reasoningFeedbackPath),
    /schema validation/);
  assert.throws(
    () => validateTeacherFeedbackParseResult({
      ...result,
      feedbackRecords: [{
        ...result.feedbackRecords[0],
        confidence: 1
      }]
    }, runPath, reasoningFeedbackPath),
    /does not match its source run and feedback bytes/);
  assert.throws(
    () => validateTeacherFeedbackParseResult({
      ...result,
      feedbackRecords: [{
        ...result.feedbackRecords[0],
        source: "auto_collected"
      }]
    }, runPath, reasoningFeedbackPath),
    /schema validation/);
  assert.throws(
    () => validateTeacherFeedbackParseResult({
      ...result,
      optimizationCandidateRefs: ["optimization-candidate.json"]
    }, runPath, reasoningFeedbackPath),
    /schema validation/);
});

test("teacher CLI writes atomically and rejects input aliases", (context) => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const feedbackPath = reasoningFeedbackPath;
    const outputPath = path.join(directory, "teacher-feedback-parse-result.json");
    const result = runCli(feedbackPath, outputPath);
    assert.equal(result.status, 0, result.stderr);
    validateTeacherFeedbackParseResult(readJson(outputPath), runPath, feedbackPath);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);

    const original = fs.readFileSync(feedbackPath);
    const direct = runCli(feedbackPath, feedbackPath);
    assert.notEqual(direct.status, 0);
    assert.match(direct.stderr, /outside the canonical teacher fixture root/);
    assert.deepEqual(fs.readFileSync(feedbackPath), original);

    const hardlinkPath = path.join(directory, "hardlink-output.json");
    try {
      fs.linkSync(feedbackPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const hardlink = runCli(feedbackPath, hardlinkPath);
    assert.notEqual(hardlink.status, 0);
    assert.match(hardlink.stderr, /must not alias/);
  });
});

test("teacher CLI rejects a junction ancestor targeting canonical sample authority", (context) => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const sampleRoot = path.join(repoRoot, "样例交付");
    const linkedRoot = path.join(directory, "sample-root-link");
    try {
      fs.symlinkSync(sampleRoot, linkedRoot, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`junction unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const escapedOutput = path.join(linkedRoot, "new-output-dir", "result.json");
    const result = runCli(reasoningFeedbackPath, escapedOutput);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the canonical sample root/);
    assert.equal(fs.existsSync(path.join(sampleRoot, "new-output-dir")), false);
  });
});

test("committed synthetic teacher fixtures recompile deterministically", () => {
  const fixtureDirectory = path.join(
    repoRoot,
    "eval",
    "sample-flywheel",
    "cases",
    "synthetic-teacher-feedback");
  for (const [name, runName, disposition] of [
    ["reasoning-medium", "generated-arithmetic-slip", "parsed"],
    ["format-low", "generated-format-omission", "parsed"],
    ["ambiguous-reasoning-format", "generated-transposition-slip", "needs_human_label"]
  ]) {
    const feedbackPath = path.join(
      fixtureDirectory,
      `${name}.teacher-feedback-submission.json`);
    const resultPath = path.join(fixtureDirectory, `${name}.feedback-parse-result.json`);
    const sourceRunPath = path.join(
      fixtureRoot,
      `${runName}.sample-run-record.json`);
    const committed = readJson(resultPath);
    assert.deepEqual(
      compileTeacherFeedbackParseResult({ runPath: sourceRunPath, feedbackPath }),
      committed);
    assert.equal(committed.parseDisposition, disposition);
    assert.deepEqual(committed.optimizationCandidateRefs, []);
  }
  validateCanonicalTeacherFeedbackFixtures();
});

function usingSubmission(text, action) {
  const directory = fs.mkdtempSync(
    path.join(path.parse(repoRoot).root, "classroom-teacher-feedback-"));
  try {
    const feedbackPath = path.join(directory, "teacher-feedback-submission.json");
    const submission = {
      schemaVersion: "1.0",
      kind: "teacher-feedback-submission",
      submissionId: "synthetic-teacher-feedback",
      sampleId: "synthetic-linear-equation",
      subjectPack: "math-answer",
      sourceRunRef: path.relative(directory, runPath).split(path.sep).join("/"),
      sourceRunSha256: sha256File(runPath),
      fixtureKind: "synthetic_fixture",
      dataClassification: {
        level: "public",
        notes: "repository-owned synthetic teacher feedback"
      },
      text,
      reporter: "synthetic_teacher_fixture",
      createdAt: "2026-07-26T13:00:00.000Z"
    };
    writeJson(feedbackPath, submission);
    action({ directory, feedbackPath, submission });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function usingSameVolumeTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(
    path.join(path.parse(repoRoot).root, "classroom-teacher-feedback-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(feedbackPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "teacher-feedback-parse.mjs"),
      "--run", runPath,
      "--feedback", feedbackPath,
      "--out", outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
