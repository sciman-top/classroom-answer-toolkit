import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildDiffReport, lineDiff, main } from "./answer-diff-report.mjs";

test("line diff records added and removed answer lines", () => {
  const diff = lineDiff("# 答案\n\n1. C\n2. B", "# 答案\n\n1. D\n2. B");
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.ok(diff.lines.includes("-1. C"));
  assert.ok(diff.lines.includes("+1. D"));
  assert.ok(diff.lines.includes(""));
  assert.ok(diff.lines.every((line) => !/[ \t]+$/.test(line)));
});

test("diff report records SHA-256 for the exact file bytes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "answer-diff-hash-"));
  const beforePath = path.join(directory, "before.md");
  const afterPath = path.join(directory, "after.md");
  try {
    const before = "# 答案\r\n\r\n1. B\r\n";
    const after = "# 答案\n\n1. C\n";
    writeFileSync(beforePath, before, "utf8");
    writeFileSync(afterPath, after, "utf8");

    const report = buildDiffReport(beforePath, afterPath);
    const expectedBeforeHash = crypto.createHash("sha256").update(Buffer.from(before)).digest("hex");
    const expectedAfterHash = crypto.createHash("sha256").update(Buffer.from(after)).digest("hex");
    assert.ok(report.includes(`候选 SHA-256：\`${expectedBeforeHash}\``));
    assert.ok(report.includes(`校正 SHA-256：\`${expectedAfterHash}\``));
    assert.doesNotMatch(report, /[ \t]+$/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review evidence records exact unresolved question numbers and rejects missing questions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "answer-diff-evidence-"));
  const beforePath = path.join(directory, "before.md");
  const afterPath = path.join(directory, "after.md");
  const reportPath = path.join(directory, "report.md");
  const evidencePath = path.join(directory, "evidence.json");
  const missingPath = path.join(directory, "missing.md");
  try {
    writeFileSync(beforePath, "# 参考答案\n\n1. A\n2. B\n3. C\n", "utf8");
    writeFileSync(afterPath,
      "# 参考答案\n\n1. Z\n2. B\n3. C\n\n## 疑点清单\n\n- 第2题：待人工复核。\n",
      "utf8");
    const priorInitCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = process.cwd();
    try {
      main([beforePath, afterPath, reportPath, "--evidence-out", evidencePath]);
    } finally {
      if (priorInitCwd === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = priorInitCwd;
    }
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.deepEqual(evidence.unresolvedQuestions, [2]);
    assert.deepEqual(evidence.missingQuestions, []);
    assert.ok(evidence.diff.added + evidence.diff.removed > 0);
    assert.ok(evidence.diff.lines.includes("+1. Z"));
    assert.ok(evidence.diff.lines.includes("-1. A"));

    writeFileSync(missingPath, "# 参考答案\n\n1. Z\n", "utf8");
    assert.throws(
      () => main([beforePath, missingPath, path.join(directory, "missing-report.md")]),
      /missing question numbers: 2, 3/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review evidence carries prior confirmed and unresolved sets across stages", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "answer-diff-evidence-carry-"));
  const priorEvidencePath = path.join(directory, "prior-evidence.json");
  const beforePath = path.join(directory, "visual-before.md");
  const afterPath = path.join(directory, "visual-after.md");
  const reportPath = path.join(directory, "visual-report.md");
  const evidencePath = path.join(directory, "visual-evidence.json");
  try {
    // Stage 1 wrote this flat evidence file; stage 2 must read it without a
    // "review" wrapper and carry its sets forward.
    writeFileSync(priorEvidencePath, `${JSON.stringify({
      schemaVersion: "1.0",
      kind: "answer-review-evidence",
      coveredQuestions: [2, 5],
      confirmedCorrections: [3],
      directCorrections: [],
      unresolvedQuestions: [5],
      missingQuestions: [],
      diff: { lines: [], added: 0, removed: 0 }
    }, null, 2)}\n`, "utf8");
    writeFileSync(beforePath, "# 参考答案\n\n1. A\n2. B\n3. C\n5. E\n", "utf8");
    writeFileSync(afterPath,
      "# 参考答案\n\n1. A\n2. B\n3. D\n5. E\n\n- 第5题：待人工复核。\n",
      "utf8");
    const priorInitCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = process.cwd();
    try {
      main([
        beforePath, afterPath, reportPath,
        "--semantic-evidence", priorEvidencePath,
        "--visual-findings", path.join(directory, "nonexistent-findings.md"),
        "--evidence-out", evidencePath
      ]);
    } finally {
      if (priorInitCwd === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = priorInitCwd;
    }
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.deepEqual(evidence.confirmedCorrections, [3]);
    // The visual stage rewrote question 3's answer and appended the 待复核
    // marker line to question 5's block, so both count as textual changes.
    assert.deepEqual(evidence.directCorrections, [3, 5]);
    assert.deepEqual(evidence.unresolvedQuestions, [5]);
    assert.deepEqual(evidence.coveredQuestions, [1, 2, 3, 5]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference stage supersedes carried unresolved questions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "answer-diff-evidence-reference-"));
  const priorEvidencePath = path.join(directory, "prior-evidence.json");
  const referencePdfPath = path.join(directory, "reference.pdf");
  const beforePath = path.join(directory, "reference-before.md");
  const afterPath = path.join(directory, "reference-after.md");
  const reportPath = path.join(directory, "reference-report.md");
  const evidencePath = path.join(directory, "reference-evidence.json");
  try {
    writeFileSync(priorEvidencePath, `${JSON.stringify({
      schemaVersion: "1.0",
      kind: "answer-review-evidence",
      coveredQuestions: [4],
      confirmedCorrections: [4],
      directCorrections: [],
      unresolvedQuestions: [4],
      missingQuestions: [],
      diff: { lines: [], added: 0, removed: 0 }
    }, null, 2)}\n`, "utf8");
    writeFileSync(referencePdfPath, "%PDF-reference", "utf8");
    writeFileSync(beforePath, "# 参考答案\n\n4. A\n", "utf8");
    writeFileSync(afterPath, "# 参考答案\n\n4. B\n", "utf8");
    const priorInitCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = process.cwd();
    try {
      main([
        beforePath, afterPath, reportPath,
        "--semantic-evidence", priorEvidencePath,
        "--reference-evidence", referencePdfPath,
        "--evidence-out", evidencePath
      ]);
    } finally {
      if (priorInitCwd === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = priorInitCwd;
    }
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    // The reference comparison ran, so the carried unresolved set is
    // superseded; the textual correction is still recorded.
    assert.deepEqual(evidence.unresolvedQuestions, []);
    assert.deepEqual(evidence.directCorrections, [4]);
    assert.deepEqual(evidence.confirmedCorrections, [4]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
