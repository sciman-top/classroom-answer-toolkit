import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { countMathRegions, exportAnswerDocx } from "./export-answer-docx.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const tempRoot = path.join(os.tmpdir(), "export-answer-docx-test");

function hasPandoc() {
  const probe = spawnSync("pandoc", ["--version"], { encoding: "utf8", windowsHide: true });
  return !probe.error && probe.status === 0;
}

const fixtureMarkdown = [
  "# 测试参考答案",
  "",
  "13. 速度为 $v=\\frac{s}{t}=\\frac{1\\,\\mathrm{m}}{2\\,\\mathrm{s}}=0.5\\,\\mathrm{m/s}$。",
  "",
  "14. 重量为 \\(G=mg=100\\,\\mathrm{N}\\)，两行内联公式均需保留。",
  "",
  "$$Q_{\\text{吸}}=cm\\Delta t=2.1\\times10^5\\,\\mathrm{J}$$",
  "",
  "\\[p=\\frac{F}{S}=500\\,\\mathrm{Pa}\\]",
  ""
].join("\n");

test("countMathRegions covers all four delimiter styles", () => {
  assert.equal(countMathRegions(fixtureMarkdown), 4);
  assert.equal(countMathRegions("无公式段落。"), 0);
});

test("exportAnswerDocx produces OMML equations matching the Markdown math regions", { skip: hasPandoc() ? false : "pandoc not on PATH" }, () => {
  fs.mkdirSync(tempRoot, { recursive: true });
  const markdownPath = path.join(tempRoot, "测试参考答案.md");
  const outputPath = path.join(tempRoot, "测试参考答案.docx");
  fs.writeFileSync(markdownPath, fixtureMarkdown, "utf8");

  const result = exportAnswerDocx({ markdownPath, outputPath });
  assert.equal(result.outputPath, outputPath);
  assert.ok(fs.existsSync(outputPath), "pandoc must write the DOCX file");
  assert.ok(result.mathReport, "verification runs by default");
  assert.equal(result.mathReport.expected, 4);
  assert.equal(result.mathReport.actual, 4);
});

test("exportAnswerDocx rejects output whose math count diverges", { skip: hasPandoc() ? false : "pandoc not on PATH" }, () => {
  fs.mkdirSync(tempRoot, { recursive: true });
  const markdownPath = path.join(tempRoot, "货币误判.md");
  // The renderer scanner reads `$100和$` as one math region; pandoc refuses the
  // closing `$` because a digit follows it, so the DOCX would silently lose the
  // region unless verification compares both sides.
  fs.writeFileSync(markdownPath, "# 货币误判\n\n13. 价格为 $100和$200 元。\n", "utf8");

  assert.throws(
    () => exportAnswerDocx({ markdownPath }),
    (error) => error.message.includes("DOCX math verification failed"),
    "a math region pandoc could not reproduce must fail the export"
  );
});

test("module is importable without side effects", () => {
  assert.ok(pathToFileURL(scriptPath).href.length > 0);
});
