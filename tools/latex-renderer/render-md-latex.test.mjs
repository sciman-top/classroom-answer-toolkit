import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, "..", "..");

test("renderer keeps Markdown tables as bordered, non-splitting layout blocks", () => {
  const rendererSource = fs.readFileSync(path.join(toolDirectory, "render-md-latex.mjs"), "utf8");

  assert.match(rendererSource, /table\s*\{[\s\S]*?border-collapse:\s*collapse;[\s\S]*?break-inside:\s*avoid;/u);
  assert.match(rendererSource, /th,\s*td\s*\{[\s\S]*?border:\s*0\.5pt solid #333;/u);
});

test("renderer converts a multiline inline math fence without leaking LaTeX source", () => {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-answer-render-"));
  const markdownPath = path.join(workDirectory, "multiline-math.md");
  const pdfPath = path.join(workDirectory, "multiline-math.pdf");
  const reviewDirectory = path.join(workDirectory, "review");
  fs.writeFileSync(markdownPath, [
    "# 物理试卷参考答案",
    "",
    "11．（2）$t=\\frac{W}{P}",
    "=\\frac{4.8\\,\\mathrm{kW\\cdot h}}{0.08\\,\\mathrm{kW}}",
    "=60\\,\\mathrm{h}$。"
  ].join("\n"), "utf8");

  try {
    execFileSync(process.execPath, [
      "render-md-latex.mjs",
      markdownPath,
      pdfPath,
      "--subject-pack", "junior-physics-answer"
    ], { cwd: toolDirectory, stdio: "pipe" });
    execFileSync(process.execPath, [
      "review-source-pdf.mjs",
      pdfPath,
      "--out", reviewDirectory,
      "--pages", "all"
    ], { cwd: toolDirectory, stdio: "pipe" });

    const extractedText = fs.readFileSync(path.join(reviewDirectory, "multiline-math.page-001.text-layer.txt"), "utf8");
    assert.doesNotMatch(extractedText, /\$|\\frac|\\mathrm/u);
    assert.match(extractedText, /60/u);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});

test("renderer keeps a question's trailing formula block together near a page boundary", () => {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-answer-pagination-"));
  const markdownPath = path.join(workDirectory, "question-pagination.md");
  const pdfPath = path.join(workDirectory, "question-pagination.pdf");
  const reviewDirectory = path.join(workDirectory, "review");
  const prefix = Array.from({ length: 20 }, (_value, index) =>
    `前置内容 ${index + 1}，用于填充分页测试。`
  ).join("\n\n");
  fs.writeFileSync(markdownPath, [
    "# 物理试卷参考答案",
    "",
    prefix,
    "",
    "24. （1）Q24-BEGIN",
    "",
    "（2）保持水面恢复到原标记位置。",
    "",
    "玩具鸭漂浮时，$F_{\\text{浮}}=G_{\\text{鸭}}$。",
    "",
    "Q24-END"
  ].join("\n"), "utf8");

  try {
    execFileSync(process.execPath, [
      "render-md-latex.mjs",
      markdownPath,
      pdfPath,
      "--subject-pack", "junior-physics-answer"
    ], { cwd: toolDirectory, stdio: "pipe" });
    execFileSync(process.execPath, [
      "review-source-pdf.mjs",
      pdfPath,
      "--out", reviewDirectory,
      "--pages", "all"
    ], { cwd: toolDirectory, stdio: "pipe" });

    const pageTexts = fs.readdirSync(reviewDirectory)
      .filter((fileName) => fileName.endsWith(".text-layer.txt"))
      .sort()
      .map((fileName) => fs.readFileSync(path.join(reviewDirectory, fileName), "utf8"));
    const questionPage = pageTexts.findIndex((pageText) => pageText.includes("Q24-BEGIN"));
    assert.notEqual(questionPage, -1);
    assert.match(pageTexts[questionPage], /Q24-END/u);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});
