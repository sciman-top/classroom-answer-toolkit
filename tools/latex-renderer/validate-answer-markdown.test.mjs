import assert from "node:assert/strict";
import test from "node:test";
import { findStrictKatexErrors, findLeakingDollarLines } from "./validate-answer-markdown.mjs";

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

test("leak check flags adjacent-dollar sequences the renderer leaves literal", () => {
  // Renderer scanner consumes only `$a$`; the trailing `$b$` would print verbatim.
  assert.deepEqual(findLeakingDollarLines("$a$$b$\n"), [1]);
});

test("leak check passes balanced, escaped, and display-only dollar usage", () => {
  assert.deepEqual(findLeakingDollarLines([
    "速度为 $v=2\\,\\mathrm{m/s}$，动能记作 \\$5。",
    "\\[ E_k = 3\\,\\mathrm{J} \\]"
  ].join("\n")), []);
});

test("leak check reports the document line of a stray dollar", () => {
  assert.deepEqual(findLeakingDollarLines([
    "第一行没有美元。",
    "第二行价格 $9 到期。"
  ].join("\n")), [2]);
});
