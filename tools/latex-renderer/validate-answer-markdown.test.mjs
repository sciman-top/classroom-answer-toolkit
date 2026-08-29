import assert from "node:assert/strict";
import test from "node:test";
import {
  findStrictKatexErrors,
  findLeakingDollarLines,
  findUnbalancedLatexParenDelimiterLines
} from "./validate-answer-markdown.mjs";
import { repairSplitMathSpans } from "./inline-math.mjs";

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

test("paren-delimited inline math is normalized before strict KaTeX and leak checks", () => {
  // 2015 regression10 delivery defect: `\(...\)` rendered as literal source.
  const good = String.raw`速度为 \(v=2\,\mathrm{m/s}\)。`;
  assert.deepEqual(findStrictKatexErrors(good), []);
  assert.deepEqual(findLeakingDollarLines(good), []);

  const broken = String.raw`速度为 \(v=\frac{1}{2\)。`;
  assert.equal(findStrictKatexErrors(broken).length, 1);
});

test("split-frac across adjacent math spans is repaired before checks", () => {
  // 2026 run3/run5/run7 defect: numerator span, denominator span.
  const split = [
    "$=\\frac{450\\,\\mathrm{N}}$",
    "${1.0\\times10^3\\,\\mathrm{kg/m^3}\\times10\\,\\mathrm{N/kg}}$",
    ""
  ].join("\n");
  const repaired = repairSplitMathSpans(split);
  assert.deepEqual(findStrictKatexErrors(repaired), []);
  assert.ok(repaired.includes("$=\\frac{450\\,\\mathrm{N}}{1.0\\times10^3\\,\\mathrm{kg/m^3}\\times10\\,\\mathrm{N/kg}}$"));

  // A self-contained span followed by another span must stay untouched.
  const intact = "$a=1$ $b=2$\n";
  assert.equal(repairSplitMathSpans(intact), intact);
});

test("split-frac behind an intact span is still repaired (run11 form)", () => {
  // 2026 run11 defect: `$\rho=\frac{m}{V}$` (intact) precedes the broken pair,
  // and one non-overlapping replace pass can never reach the broken pair.
  const split = [
    "$\\rho=\\frac{m}{V}$",
    "$=\\frac{243.00\\,\\mathrm{g}}$",
    "${9.00\\,\\mathrm{cm}\\times9.00\\,\\mathrm{cm}\\times2.00\\,\\mathrm{cm}}$",
    "$=1.5\\,\\mathrm{g/cm^3}$。"
  ].join("\n");
  const repaired = repairSplitMathSpans(split);
  assert.deepEqual(findStrictKatexErrors(repaired), []);
  assert.ok(repaired.includes("$=\\frac{243.00\\,\\mathrm{g}}{9.00\\,\\mathrm{cm}\\times9.00\\,\\mathrm{cm}\\times2.00\\,\\mathrm{cm}}$"));

  // A fully self-contained multi-line derivation stays byte-identical.
  const derivation = "$\\eta=\\frac{W}{Q}$\n$=\\frac{300}{1000}$\n$=30\\%$。\n";
  assert.equal(repairSplitMathSpans(derivation), derivation);
});

test("paren-delimited math keeps later findings on their actual line and rejects unbalanced delimiters", () => {
  const laterInvalidMath = String.raw`\(v=2\)
$E_{甲}$`;
  assert.deepEqual(findStrictKatexErrors(laterInvalidMath).map((finding) => finding.lineNumber), [2]);

  const unbalanced = String.raw`第一行 \) 没有起始
第二行 \(v=2`;
  assert.deepEqual(findUnbalancedLatexParenDelimiterLines(unbalanced), [1, 2]);
});
