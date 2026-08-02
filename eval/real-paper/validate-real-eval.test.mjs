import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadBaselines, validateBaselineFiles, validateBaselineShape } from "./validate-real-eval.mjs";

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
      targetQuestions: [1],
      authority: {
        sourceExam: { path: "authority/source.pdf", sha256: digest("source") },
        referenceAnswer: { path: "authority/reference.pdf", sha256: digest("reference") }
      },
      stages: {
        blind: { status: "evaluated", artifact: { path: "artifacts/blind.md", sha256: digest("blind") }, cases: { "1": "fail" } },
        visualAudit: { status: "not_run", artifact: null, cases: { "1": "not_evaluated" } },
        referenceReview: { status: "evaluated", artifact: { path: "artifacts/reference.md", sha256: digest("corrected") }, cases: { "1": "pass" } }
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
