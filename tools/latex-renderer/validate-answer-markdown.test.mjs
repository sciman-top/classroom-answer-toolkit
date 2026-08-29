import assert from "node:assert/strict";
import test from "node:test";
import {
  findStrictKatexErrors,
  findLeakingDollarLines,
  findUnbalancedLatexDelimiterLines
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

test("leak check keeps line numbers accurate after multi-line display math", () => {
  // The display block spans lines 1-3; a token without the matched newlines
  // would report the stray dollar on line 3 instead of line 5.
  assert.deepEqual(findLeakingDollarLines([
    "$$",
    "E = mc^2",
    "$$",
    "",
    "第五行价格 $9 到期。"
  ].join("\n")), [5]);
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
  assert.deepEqual(findUnbalancedLatexDelimiterLines(unbalanced), [1, 2]);
});

test("unclosed display delimiters are rejected like unclosed paren delimiters", () => {
  // Same defect class as 2015 regression10: an unclosed `\[` degrades to a
  // literal `[` in the rendered PDF.
  assert.deepEqual(findUnbalancedLatexDelimiterLines(String.raw`第一行 \[ F=ma`), [1]);
  assert.deepEqual(findUnbalancedLatexDelimiterLines(String.raw`第一行 F=ma \] 没有起始`), [1]);
  assert.deepEqual(findUnbalancedLatexDelimiterLines(String.raw`\[ F=ma \]`), []);
  assert.deepEqual(findUnbalancedLatexDelimiterLines(String.raw`平衡的 \(v=2\) 与 \[E=3\,\mathrm{J}\]`), []);
});

test("math inside code fences and same-line inline code is opaque to math checks", () => {
  const fenced = [
    "```text",
    "$\\frac{1}{$",
    "```",
    "",
    "$E_{甲}$"
  ].join("\n");
  // Only the real math on the last line is reported; the fence content is exempt.
  assert.deepEqual(findStrictKatexErrors(fenced).map((finding) => finding.lineNumber), [5]);
  assert.deepEqual(findLeakingDollarLines("```text\n$a$$b$\n```\n正文 $v=2$。"), []);

  const inlineCode = "记作 `$a$$b$` 但正文 $v=2$。";
  assert.deepEqual(findLeakingDollarLines(inlineCode), []);
});

test("fenced code is opaque to delimiter and dollar-parity checks with accurate line numbers", () => {
  // Reviewer repro: an unclosed `\[` inside a fence is literal content and must
  // not be reported; one after the fence must still be reported on its real line.
  const fenced = [
    "```text",
    "$\\frac{1}{$ 与未闭合 \\[",
    "```",
    "",
    "第五行 \\[ 未闭合"
  ].join("\n");
  assert.deepEqual(findUnbalancedLatexDelimiterLines(fenced), [5]);
  // A lone `$` inside a fence must not flip the document's dollar parity.
  assert.deepEqual(findLeakingDollarLines("```text\n单个 $\n```\n正文 $v=2$。"), []);
});

test("cross-line inline code spans are masked like single-line spans", () => {
  const span = [
    "记作 `值",
    "$E_{甲}$` 但正文 $v=2$。"
  ].join("\n");
  assert.deepEqual(findStrictKatexErrors(span), []);
  assert.deepEqual(findLeakingDollarLines(span), []);

  // markdown-it renders math inside an unclosed backtick run, so it must stay checked.
  const unclosed = [
    "前缀 `未闭合",
    "$E_{甲}$ 之后"
  ].join("\n");
  assert.equal(findStrictKatexErrors(unclosed).length, 1);
});

test("variable-length backtick runs only close on equal-length runs", () => {
  // The two-backtick span hides `a$b`; the real math after it is still reported.
  const text = "前 ``a$b`` 中 $E_{甲}$ 后";
  assert.deepEqual(findStrictKatexErrors(text).map((finding) => finding.lineNumber), [1]);
  assert.deepEqual(findLeakingDollarLines("记 ``a$$b`` 作 与 $v$。"), []);
});
