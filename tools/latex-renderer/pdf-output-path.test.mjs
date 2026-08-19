import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  commitBrowserPdfOutput,
  makeBrowserPdfOutputPath,
  makeRenderTempHtmlPath,
  makeReviewOutputDir
} from "./pdf-output-path.mjs";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { removePathRecursive } from "../safe-remove.mjs";

test("browser PDF output always uses an ASCII temporary file name", () => {
  const target = path.join("D:\\repo\\正式交付", "2025广州中考参考答案.pdf");
  const temporary = makeBrowserPdfOutputPath(target, "fixed-token");

  assert.equal(path.dirname(temporary), path.dirname(target));
  assert.match(path.basename(temporary), /^\.classroom-toolkit-render-fixed-token\.pdf$/);
  assert.match(path.basename(temporary), /^[\x00-\x7F]+$/);
});

test("render HTML uses a stable ASCII file name for Unicode targets", () => {
  const target = path.join("D:\\repo\\正式交付", "2025广州中考参考答案.pdf");
  const temporary = makeRenderTempHtmlPath(target);

  assert.equal(path.dirname(temporary), path.dirname(target));
  assert.match(path.basename(temporary), /^\.classroom-toolkit-render-[a-f0-9]{16}\.html$/);
  assert.match(path.basename(temporary), /^[\x00-\x7F]+$/);
  assert.equal(makeRenderTempHtmlPath(target), temporary);
});

test("committing browser output replaces the final Unicode target after rendering", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-render-output-"));
  const target = path.join(directory, "2025广州中考参考答案.pdf");
  const temporary = makeBrowserPdfOutputPath(target, "replace");
  try {
    writeFileSync(target, "old", "utf8");
    writeFileSync(temporary, "new", "utf8");

    commitBrowserPdfOutput(temporary, target);

    assert.equal(readFileSync(target, "utf8"), "new");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review output uses a bounded safe folder for a PDF on another drive", () => {
  const reviewDirectory = makeReviewOutputDir(
    "D:\\repo\\classroom-answer-toolkit",
    "C:\\正式交付\\2025广州中考参考答案.pdf"
  );

  assert.equal(path.dirname(reviewDirectory), "D:\\repo\\classroom-answer-toolkit\\.pdf-review");
  assert.match(path.basename(reviewDirectory), /^external-[a-f0-9]{16}__2025广州中考参考答案$/);
  assert.doesNotMatch(path.basename(reviewDirectory), /:/);
});

test("atomic text writes replace an existing Unicode file without leaving a temporary artifact", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-atomic-write-"));
  const target = path.join(directory, "2023广州中考盲答候选.md");
  try {
    writeFileSync(target, "old", "utf8");

    writeTextFileAtomic(target, "new");

    assert.equal(readFileSync(target, "utf8"), "new");
    assert.deepEqual(readdirSync(directory), ["2023广州中考盲答候选.md"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recursive cleanup removes a nested Unicode directory tree", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-safe-remove-"));
  const target = path.join(directory, "正式交付", "2023广州中考参考答案");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "review.txt"), "review", "utf8");

  removePathRecursive(path.join(directory, "正式交付"));

  assert.deepEqual(readdirSync(directory), []);
  rmSync(directory, { recursive: true, force: true });
});

test("PDF review rejects an unknown option instead of silently using a default", () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./review-source-pdf.mjs", import.meta.url)),
    "missing.pdf",
    "--scal",
    "4"
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unknown argument: --scal/);
});
