import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeReviewHtml } from "./review-html.mjs";

function buildManifest() {
  return {
    renderer: "pdfjs-dist + local Chrome/Edge via Playwright",
    selectedPages: [1, 2],
    pages: [
      {
        kind: "page-tile",
        pageNumber: 1,
        imagePath: "/tmp/review/exam.page-001.png",
        width: 1000,
        height: 1400,
        textLayerPath: "/tmp/review/exam.page-001.text-layer.txt"
      },
      {
        kind: "focus-region",
        pageNumber: 2,
        imagePath: "/tmp/review/exam.page-002.focus-01.meter.png",
        width: 400,
        height: 300,
        focusLabel: "voltmeter <panel A>"
      }
    ]
  };
}

test("writeReviewHtml writes one section per page and escapes markup", () => {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "review-html-"));
  try {
    const htmlPath = writeReviewHtml({ outputDir, inputPath: "D:\\试卷\\source&<exam>.pdf", manifest: buildManifest() });
    assert.equal(htmlPath, path.join(outputDir, "review.html"));
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /PDF source review/);
    assert.equal((html.match(/<section>/g) ?? []).length, 2);
    assert.match(html, /Page 2 focus: voltmeter &lt;panel A&gt;/);
    assert.match(html, /source&amp;&lt;exam&gt;\.pdf/);
    assert.match(html, /alt="Page 1"/);
    assert.doesNotMatch(html, /voltmeter <panel/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
