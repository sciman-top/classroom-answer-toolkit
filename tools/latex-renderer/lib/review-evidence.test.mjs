import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const toolDir = path.dirname(fileURLToPath(import.meta.url));

test("review manifest binds its PDF bytes and review page coverage", { timeout: 120_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-evidence-"));
  const pdfPath = path.join(root, "answer.pdf");
  const reviewPath = path.join(root, "answer.review");
  try {
    fs.writeFileSync(pdfPath, createSinglePagePdf());
    const run = await runTool("review-source-pdf.mjs", [
      pdfPath, "--out", reviewPath, "--pages", "all"
    ]);
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(reviewPath, "manifest.json"), "utf8"));
    assert.equal(manifest.kind, "pdf-source-review");
    assert.equal(manifest.inputPath, pdfPath);
    assert.equal(manifest.selectedPages.length, manifest.pageCount);
    assert.ok(manifest.pages.length > 0);
    assert.ok(manifest.reviewHtmlPath);
    const html = fs.readFileSync(path.join(reviewPath, "review.html"), "utf8");
    assert.match(html, /<img\b/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runTool(scriptName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(toolDir, "..", scriptName), ...args], {
      cwd: toolDir,
      env: { ...process.env, INIT_CWD: process.cwd() }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stderr, stdout }));
  });
}

function createSinglePagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}
