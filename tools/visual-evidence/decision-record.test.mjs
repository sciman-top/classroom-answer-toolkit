import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compileDecisionRecord,
  validateDecisionRecord
} from "./decision-record.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const caseRoot = path.join(repoRoot, "eval", "visual-evidence", "cases");

function readCaseJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, fileName), "utf8"));
}

test("compileDecisionRecord keeps dual-track agreement fail-closed when evidence is missing", () => {
  const evidenceBundle = readCaseJson("dual-track-match-evidence-missing.problem-evidence-bundle.json");
  const trackResults = [
    readCaseJson("dual-track-match-evidence-missing.track-a.json"),
    readCaseJson("dual-track-match-evidence-missing.track-b.json"),
    readCaseJson("dual-track-match-evidence-missing.track-c.json")
  ];

  const decisionRecord = compileDecisionRecord({
    evidenceBundle,
    trackResults,
    generatedAt: "2026-07-08T00:00:00.000Z"
  });

  assert.equal(decisionRecord.kind, "decision-record");
  assert.equal(decisionRecord.evidenceBundleRef, evidenceBundle.evidenceBundleId);
  assert.equal(decisionRecord.decision, "review_required");
  assert.equal(decisionRecord.trusted, false);
  assert.equal(decisionRecord.visualReviewPassed, null);
  assert.equal(decisionRecord.reviewRequired, true);
  assert.equal(decisionRecord.reviewQueue, "high_risk_approval");
  assert.equal(decisionRecord.statusProjection.trusted, false);
  assert.equal(decisionRecord.statusProjection.visualReviewPassed, null);
  assert.ok(decisionRecord.decisionReasons.includes("dual_track_match"));
  assert.ok(decisionRecord.decisionReasons.includes("evidence_chain_missing"));
  assert.ok(decisionRecord.decisionReasons.includes("high_risk_visual"));
  assert.deepEqual(validateDecisionRecord(decisionRecord), []);
});
