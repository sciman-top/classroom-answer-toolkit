import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commitBrowserPdfOutput,
  makeBrowserPdfOutputPath,
  makeRenderTempHtmlPath
} from "./pdf-output-path.mjs";

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
