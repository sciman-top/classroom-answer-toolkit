import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildDiffReport, lineDiff } from "./answer-diff-report.mjs";

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
