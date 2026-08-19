import assert from "node:assert/strict";
import test from "node:test";
import { findStrictKatexErrors } from "./validate-answer-markdown.mjs";

test("strict validator rejects bare CJK labels in inline and display math", () => {
  const findings = findStrictKatexErrors([
    "$E_{k乙}=2\\,\\mathrm{J}$",
    "\\[",
    "F^{甲}=3\\,\\mathrm{N}",
    "\\]"
  ].join("\n"));

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.lineNumber), [2, 1]);
  assert.ok(findings.every((finding) => /Unicode text character/u.test(finding.message)));
});

test("strict validator accepts CJK labels wrapped in LaTeX text", () => {
  assert.deepEqual(
    findStrictKatexErrors("$E_{k\\text{乙}}=2\\,\\mathrm{J}$\n\\[F^{\\text{甲}}=3\\,\\mathrm{N}\\]"),
    []
  );
});
