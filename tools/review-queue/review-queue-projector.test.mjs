import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compileDecisionRecord } from "../visual-evidence/decision-record.mjs";
import { projectReviewQueue } from "./review-queue-projector.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const teacherResult = path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-teacher-feedback",
  "ambiguous-reasoning-format.feedback-parse-result.json");
const highRiskDecision = path.join(
  repoRoot,
  "eval",
  "visual-evidence",
  "cases",
  "visual-risk",
  "math-ocr-image-conflict.decision-record.json");

test("projects admitted artifacts deterministically and keeps queues separate", () => {
  const first = projectReviewQueue([highRiskDecision, teacherResult]);
  const second = projectReviewQueue([teacherResult, highRiskDecision]);

  assert.deepEqual(first, second);
  assert.equal(first.succeeded, true);
  assert.deepEqual(first.counts, {
    needsHumanLabel: 1,
    highRiskApproval: 1,
    truthNeedsReview: 0
  });
  assert.deepEqual(first.items.map((item) => item.queue), [
    "needs_human_label",
    "high_risk_approval"
  ]);
  assert.ok(first.items.every((item) => /^[a-f0-9]{64}$/.test(item.sourceSha256)));
});

test("projects truth_needs_review from a source-recomputed DecisionRecord", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-queue-truth-"));
  try {
    const sourceBase = path.join(
      repoRoot,
      "eval",
      "visual-evidence",
      "cases",
      "dual-track-match-evidence-missing");
    const evidence = readJson(`${sourceBase}.problem-evidence-bundle.json`);
    const tracks = ["track-a", "track-b", "track-c"].map((suffix) =>
      readJson(`${sourceBase}.${suffix}.json`));
    evidence.risk = { level: "low", categories: [], reviewRequired: false };
    for (const track of tracks) {
      track.risk = { level: "low", categories: [], reviewRequired: false };
      track.validatorFindings = [];
    }
    const decision = compileDecisionRecord({
      evidenceBundle: evidence,
      trackResults: tracks,
      generatedAt: "2026-07-27T00:00:00Z"
    });
    assert.equal(decision.reviewQueue, "truth_needs_review");

    writeJson(path.join(directory, "evidence.json"), evidence);
    tracks.forEach((track, index) => writeJson(path.join(directory, `track-${index}.json`), track));
    const decisionPath = path.join(directory, "decision.json");
    writeJson(decisionPath, decision);

    const result = projectReviewQueue([decisionPath]);
    assert.equal(result.succeeded, true);
    assert.equal(result.counts.truthNeedsReview, 1);
    assert.equal(result.items[0].queue, "truth_needs_review");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts a human-approved DecisionRecord that remains blocked by high-risk gates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-queue-approved-blocked-"));
  try {
    const sourceBase = path.join(
      repoRoot,
      "eval",
      "visual-evidence",
      "cases",
      "visual-risk",
      "math-ocr-image-conflict");
    const evidence = readJson(`${sourceBase}.problem-evidence-bundle.json`);
    const track = readJson(`${sourceBase}.track-b.json`);
    const decision = compileDecisionRecord({
      evidenceBundle: evidence,
      trackResults: [track],
      generatedAt: "2026-07-27T00:00:00Z",
      humanApproved: true
    });
    assert.equal(decision.visualReviewPassed, null);
    assert.ok(decision.decisionReasons.includes("human_approved"));
    assert.equal(decision.reviewQueue, "high_risk_approval");

    writeJson(path.join(directory, "evidence.json"), evidence);
    writeJson(path.join(directory, "track.json"), track);
    const decisionPath = path.join(directory, "decision.json");
    writeJson(decisionPath, decision);

    const result = projectReviewQueue([decisionPath]);
    assert.equal(result.succeeded, true);
    assert.equal(result.counts.highRiskApproval, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails closed for duplicate, unknown, malformed, or source-drifted artifacts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-queue-reject-"));
  try {
    const unknownPath = path.join(directory, "unknown.json");
    const malformedPath = path.join(directory, "malformed.json");
    fs.writeFileSync(unknownPath, '{"kind":"unknown"}\n');
    fs.writeFileSync(malformedPath, "{not json}\n");

    for (const paths of [
      [teacherResult, teacherResult],
      [unknownPath],
      [malformedPath]
    ]) {
      const result = projectReviewQueue(paths);
      assert.equal(result.succeeded, false);
      assert.deepEqual(result.items, []);
      assert.deepEqual(result.counts, {
        needsHumanLabel: 0,
        highRiskApproval: 0,
        truthNeedsReview: 0
      });
      assert.ok(result.rejectedSources.length > 0);
    }

    const driftedPath = path.join(directory, "drifted.feedback-parse-result.json");
    const drifted = readJson(teacherResult);
    drifted.reasonCode = "missing_error_signal";
    writeJson(driftedPath, drifted);
    const driftedResult = projectReviewQueue([driftedPath]);
    assert.equal(driftedResult.succeeded, false);
    assert.match(driftedResult.rejectedSources[0].reason, /not admitted/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an empty artifact selection", () => {
  assert.throws(() => projectReviewQueue([]), /At least one/);
});

test("fails closed when two selected paths share one physical file identity", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-queue-hardlink-"));
  try {
    const copiedPath = path.join(directory, "decision-copy.json");
    const aliasPath = path.join(directory, "decision-hardlink.json");
    fs.copyFileSync(highRiskDecision, copiedPath);
    try {
      fs.linkSync(copiedPath, aliasPath);
    } catch (error) {
      context.skip(`hardlink capability unavailable: ${error.code ?? error.message}`);
      return;
    }
    const result = projectReviewQueue([copiedPath, aliasPath]);
    assert.equal(result.succeeded, false);
    assert.deepEqual(result.items, []);
    assert.ok(result.rejectedSources.some((source) =>
      /physical source identity/.test(source.reason)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
