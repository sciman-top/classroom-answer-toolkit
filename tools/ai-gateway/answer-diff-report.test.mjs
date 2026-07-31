import assert from "node:assert/strict";
import test from "node:test";

import { buildDiffReport, lineDiff } from "./answer-diff-report.mjs";

test("line diff records added and removed answer lines", () => {
  const diff = lineDiff("# 答案\n\n1. C\n2. B", "# 答案\n\n1. D\n2. B");
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.ok(diff.lines.includes("-1. C"));
  assert.ok(diff.lines.includes("+1. D"));
});
