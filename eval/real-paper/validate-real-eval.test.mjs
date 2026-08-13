import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateModelTierEvidence,
  loadBaselines,
  validateBaselineFiles,
  validateBaselineShape
} from "./validate-real-eval.mjs";

test("checked-in real-paper baselines have valid stage boundaries", () => {
  const baselines = loadBaselines();
  assert.equal(baselines.length, 2);
  for (const baseline of baselines) {
    assert.doesNotThrow(() => validateBaselineShape(baseline));
    assert.equal(baseline.teacherAccepted, false);
  }
});

test("reference pass does not overwrite blind or visual-audit failure", () => {
  const baseline = loadBaselines().find((item) => item.year === 2024);
  assert.ok(baseline);
  assert.equal(baseline.stages.blind.cases["16"], "fail");
  assert.equal(baseline.stages.visualAudit.cases["16"], "fail");
  assert.equal(baseline.stages.referenceReview.cases["16"], "pass");
});

test("current real-paper evidence does not pretend one observed tier is optimal", () => {
  const result = evaluateModelTierEvidence(loadBaselines(), "blind");
  assert.deepEqual(result, {
    status: "insufficient_comparative_evidence",
    stage: "blind",
    comparableGroups: 0,
    requiredComparableGroups: 2,
    recommendation: null
  });
});

test("tier recommendation requires repeated same-paper comparisons and a unique winner", () => {
  const fixture = (comparisonKey, tier, outcomes) => ({
    comparisonKey,
    stages: {
      blind: {
        status: "evaluated",
        execution: { model: tier.model, reasoningEffort: tier.reasoningEffort },
        cases: outcomes
      }
    }
  });
  const medium = { model: "gpt-5.6-sol", reasoningEffort: "medium" };
  const xhigh = { model: "gpt-5.6-sol", reasoningEffort: "xhigh" };
  const result = evaluateModelTierEvidence([
    fixture("paper-a", medium, { "1": "fail", "2": "pass" }),
    fixture("paper-a", xhigh, { "1": "pass", "2": "pass" }),
    fixture("paper-b", medium, { "1": "fail", "2": "fail" }),
    fixture("paper-b", xhigh, { "1": "pass", "2": "fail" })
  ]);
  assert.equal(result.status, "recommendation_available");
  assert.equal(result.comparableGroups, 2);
  assert.deepEqual(result.recommendation, { tier: "gpt-5.6-sol/xhigh", accuracy: 0.75, evaluated: 4 });
});

test("file verifier rejects changed authority bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-real-eval-"));
  try {
    fs.mkdirSync(path.join(root, "authority"), { recursive: true });
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "authority", "source.pdf"), "source");
    fs.writeFileSync(path.join(root, "authority", "reference.pdf"), "reference");
    fs.writeFileSync(path.join(root, "artifacts", "blind.md"), "blind");
    fs.writeFileSync(path.join(root, "artifacts", "reference.md"), "corrected");
    fs.writeFileSync(path.join(root, "docs", "evidence.md"), "evidence");
    const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
    const baseline = {
      schemaVersion: "1.0",
      kind: "real-paper-eval-baseline",
      id: "fixture",
      year: 2099,
      subjectPack: "junior-physics-answer",
      comparisonKey: "fixture-q1",
      targetQuestions: [1],
      authority: {
        sourceExam: { path: "authority/source.pdf", sha256: digest("source") },
        referenceAnswer: { path: "authority/reference.pdf", sha256: digest("reference") }
      },
      stages: {
        blind: { status: "evaluated", execution: { model: "gpt-5.6-sol", reasoningEffort: "medium" }, artifact: { path: "artifacts/blind.md", sha256: digest("blind") }, cases: { "1": "fail" } },
        visualAudit: { status: "not_run", execution: null, artifact: null, cases: { "1": "not_evaluated" } },
        referenceReview: { status: "evaluated", execution: { model: "gpt-5.6-sol", reasoningEffort: "medium" }, artifact: { path: "artifacts/reference.md", sha256: digest("corrected") }, cases: { "1": "pass" } }
      },
      evidenceRef: "docs/evidence.md",
      teacherAccepted: false
    };
    assert.doesNotThrow(() => validateBaselineFiles(baseline, root));
    fs.writeFileSync(path.join(root, "authority", "source.pdf"), "mutated");
    assert.throws(() => validateBaselineFiles(baseline, root), /SHA-256 mismatch/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
