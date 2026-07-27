import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compileTeacherFeedbackDiagnosticReport,
  compileTeacherFeedbackReplayDiagnosticReport,
  validateTeacherFeedbackDiagnosticReport,
  validateTeacherFeedbackReplayDiagnosticReport
} from "./teacher-feedback-diagnostic.mjs";
import { compileTeacherFeedbackParseResult } from "./teacher-feedback-parse.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const fixtureRoot = path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-teacher-feedback");
const inventoryPath = path.join(
  fixtureRoot,
  "teacher-feedback-fixture-inventory.json");
const committedReportPath = path.join(
  fixtureRoot,
  "teacher-feedback-diagnostic-report.json");
const committedReplayReportPath = path.join(
  fixtureRoot,
  "teacher-feedback-replay-diagnostic-report.json");
const readinessReportPath = path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-readiness",
  "readiness-report.json");

test("canonical teacher feedback compiles an independent diagnostic report", () => {
  const report = compileTeacherFeedbackDiagnosticReport();

  assert.equal(report.schemaVersion, "1.0");
  assert.equal(report.kind, "teacher-feedback-diagnostic-report");
  assert.match(report.reportId, /^teacher-feedback-diagnostic-[a-f0-9]{16}$/);
  assert.equal(report.fixtureSetId, "synthetic-teacher-feedback-v1");
  assert.equal(report.sourceInventorySha256, sha256File(inventoryPath));
  assert.deepEqual(report.totals, {
    totalSubmissions: 3,
    parsedCount: 2,
    needsHumanLabelCount: 1,
    structuredRate: 0.666667,
    humanLabelRate: 0.333333
  });
  assert.deepEqual(report.errorTypeCounts, {
    spec_gap: 0,
    rule_gap: 0,
    routing_error: 0,
    visual_error: 0,
    ocr_error: 0,
    reference_parse_error: 0,
    reasoning_error: 1,
    format_error: 1,
    data_quality_issue: 0
  });
  assert.deepEqual(report.severityCounts, {
    low: 1,
    medium: 1,
    high: 0,
    critical: 0
  });
  assert.deepEqual(report.reasonCodeCounts, {
    missing_error_signal: 0,
    ambiguous_error_signal: 1,
    negated_error_signal: 0,
    missing_severity_signal: 0,
    ambiguous_severity_signal: 0
  });
  assert.deepEqual(report.optimizationCandidateRefs, []);
  assert.equal(report.stopReason, "teacher_feedback_diagnostic_only_no_optimizer");
  assert.equal("eligible" in report, false);
  assert.equal("controls" in report, false);
  assert.equal("buckets" in report, false);
});

test("diagnostic validator rejects computed fields and optimization refs", () => {
  const report = compileTeacherFeedbackDiagnosticReport();
  assert.throws(
    () => validateTeacherFeedbackDiagnosticReport({
      ...report,
      totals: { ...report.totals, parsedCount: 3 }
    }),
    /does not match canonical teacher fixture bytes/);
  assert.throws(
    () => validateTeacherFeedbackDiagnosticReport({
      ...report,
      resultBindings: report.resultBindings.map((binding, index) => index === 0
        ? { ...binding, resultSha256: "0".repeat(64) }
        : binding)
    }),
    /does not match canonical teacher fixture bytes/);
  assert.throws(
    () => validateTeacherFeedbackDiagnosticReport({
      ...report,
      optimizationCandidateRefs: ["optimization-candidate.json"]
    }),
    /schema validation/);
});

test("committed teacher feedback diagnostic report recompiles deterministically", () => {
  const committed = readJson(committedReportPath);
  assert.deepEqual(compileTeacherFeedbackDiagnosticReport(), committed);
  validateTeacherFeedbackDiagnosticReport(committed);
});

test("canonical teacher feedback replays expected result bytes", () => {
  const report = compileTeacherFeedbackReplayDiagnosticReport();

  assert.equal(report.schemaVersion, "1.0");
  assert.equal(report.kind, "teacher-feedback-replay-diagnostic-report");
  assert.match(report.reportId, /^teacher-feedback-replay-[a-f0-9]{16}$/);
  assert.equal(report.fixtureSetId, "synthetic-teacher-feedback-v1");
  assert.equal(report.sourceInventorySha256, sha256File(inventoryPath));
  assert.deepEqual(report.totals, {
    totalReplays: 3,
    passedCount: 3,
    failedCount: 0,
    passRate: 1
  });
  assert.equal(report.replayBindings.length, 3);
  assert.equal(report.replayBindings.every((binding) =>
    binding.replayDisposition === "passed"
    && binding.expectedResultSha256 === binding.replayedResultSha256), true);
  assert.deepEqual(report.optimizationCandidateRefs, []);
  assert.equal(
    report.stopReason,
    "teacher_feedback_replay_diagnostic_only_no_optimizer");
  assert.equal("eligible" in report, false);
  assert.equal("controls" in report, false);
  assert.equal("buckets" in report, false);
});

test("valid replay byte mismatch is reported without changing authority", () => {
  const report = compileTeacherFeedbackReplayDiagnosticReport({
    compileResult: (options) => {
      const result = compileTeacherFeedbackParseResult(options);
      if (!options.feedbackPath.endsWith("reasoning-medium.teacher-feedback-submission.json")) {
        return result;
      }
      return {
        ...result,
        feedbackRecords: result.feedbackRecords.map((record) => ({
          ...record,
          confidence: 0.8
        }))
      };
    }
  });

  assert.deepEqual(report.totals, {
    totalReplays: 3,
    passedCount: 2,
    failedCount: 1,
    passRate: 0.666667
  });
  assert.equal(report.replayBindings[0].replayDisposition, "failed");
  assert.notEqual(
    report.replayBindings[0].expectedResultSha256,
    report.replayBindings[0].replayedResultSha256);
  assert.equal(readJson(committedReportPath).totals.totalSubmissions, 3);
});

test("replay validator rejects computed fields and optimization refs", () => {
  const report = compileTeacherFeedbackReplayDiagnosticReport();
  assert.throws(
    () => validateTeacherFeedbackReplayDiagnosticReport({
      ...report,
      totals: { ...report.totals, passedCount: 2 }
    }),
    /does not match canonical replay bytes/);
  assert.throws(
    () => validateTeacherFeedbackReplayDiagnosticReport({
      ...report,
      optimizationCandidateRefs: ["optimization-candidate.json"]
    }),
    /schema validation/);
});

test("committed teacher feedback replay report recompiles deterministically", () => {
  const committed = readJson(committedReplayReportPath);
  assert.deepEqual(compileTeacherFeedbackReplayDiagnosticReport(), committed);
  validateTeacherFeedbackReplayDiagnosticReport(committed);
});

test("replay CLI writes outside the repository and preserves readiness", () => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const readinessBefore = fs.readFileSync(readinessReportPath);
    const outputPath = path.join(
      directory,
      "teacher-feedback-replay-diagnostic-report.json");
    const result = runCli(outputPath, "replay");

    assert.equal(result.status, 0, result.stderr);
    validateTeacherFeedbackReplayDiagnosticReport(readJson(outputPath));
    assert.deepEqual(fs.readFileSync(readinessReportPath), readinessBefore);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);
  });

  const readinessBefore = fs.readFileSync(readinessReportPath);
  const rejected = runCli(readinessReportPath, "replay");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /outside the repository root/);
  assert.deepEqual(fs.readFileSync(readinessReportPath), readinessBefore);
});

test("diagnostic CLI writes atomically without changing readiness", () => {
  usingSameVolumeTemporaryDirectory((directory) => {
    const readinessBefore = fs.readFileSync(readinessReportPath);
    const outputPath = path.join(directory, "teacher-feedback-diagnostic-report.json");
    const result = runCli(outputPath);

    assert.equal(result.status, 0, result.stderr);
    validateTeacherFeedbackDiagnosticReport(readJson(outputPath));
    assert.deepEqual(fs.readFileSync(readinessReportPath), readinessBefore);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);
  });
});

test("diagnostic CLI rejects canonical-root, hardlink, and junction aliases", (context) => {
  const canonicalOutput = path.join(fixtureRoot, "teacher-feedback-diagnostic-report.json");
  const canonicalBefore = fs.readFileSync(canonicalOutput);
  const canonicalResult = runCli(canonicalOutput);
  assert.notEqual(canonicalResult.status, 0);
  assert.match(canonicalResult.stderr, /outside the canonical teacher fixture root/);
  assert.deepEqual(fs.readFileSync(canonicalOutput), canonicalBefore);

  const readinessBefore = fs.readFileSync(readinessReportPath);
  const readinessResult = runCli(readinessReportPath);
  assert.notEqual(readinessResult.status, 0);
  assert.match(readinessResult.stderr, /outside the repository root/);
  assert.deepEqual(fs.readFileSync(readinessReportPath), readinessBefore);

  usingSameVolumeTemporaryDirectory((directory) => {
    const hardlinkPath = path.join(directory, "inventory-hardlink.json");
    try {
      fs.linkSync(inventoryPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const hardlinkResult = runCli(hardlinkPath);
    assert.notEqual(hardlinkResult.status, 0);
    assert.match(hardlinkResult.stderr, /hardlink alias/);

    const readinessHardlinkPath = path.join(directory, "readiness-hardlink.json");
    const readinessBefore = fs.readFileSync(readinessReportPath);
    fs.linkSync(readinessReportPath, readinessHardlinkPath);
    const readinessHardlinkResult = runCli(readinessHardlinkPath, "replay");
    assert.notEqual(readinessHardlinkResult.status, 0);
    assert.match(readinessHardlinkResult.stderr, /hardlink alias/);
    assert.deepEqual(fs.readFileSync(readinessReportPath), readinessBefore);

    const linkedRoot = path.join(directory, "teacher-root-link");
    try {
      fs.symlinkSync(fixtureRoot, linkedRoot, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`junction unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const junctionResult = runCli(path.join(linkedRoot, "new-dir", "report.json"));
    assert.notEqual(junctionResult.status, 0);
    assert.match(junctionResult.stderr, /outside the canonical teacher fixture root/);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "new-dir")), false);
  });
});

function runCli(outputPath, reportKind) {
  const reportArgs = reportKind ? ["--report", reportKind] : [];
  return spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "teacher-feedback-diagnostic.mjs"),
      ...reportArgs,
      "--out", outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
}

function usingSameVolumeTemporaryDirectory(action) {
  const directory = fs.mkdtempSync(
    path.join(path.parse(repoRoot).root, "classroom-teacher-diagnostic-"));
  try {
    action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
