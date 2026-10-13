import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repositoryRoot } from "../shared.mjs";
import { runCleanup } from "./cleanup-answer-artifacts.mjs";

test("cleanup accepts a Windows absolute path with different casing without hanging", {
  skip: process.platform !== "win32"
}, () => {
  const local = fs.mkdtempSync(path.join(repositoryRoot, "_tmp_cleanup-case-"));
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./cleanup-answer-artifacts.mjs", import.meta.url)),
      "--keep-review", "--keep-ocr", local.toLowerCase()
    ], { encoding: "utf8", timeout: 3000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(local), false);
  } finally {
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test("cleanup refuses traversal through a junction and preserves external files", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-cleanup-"));
  const local = fs.mkdtempSync(path.join(repositoryRoot, ".eval-work-cleanup-"));
  const link = path.join(local, "_tmp_link");
  fs.mkdirSync(path.join(outside, "_tmp_child"));
  const sentinel = path.join(outside, "_tmp_child", "keep.txt");
  fs.writeFileSync(sentinel, "preserve");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => runCleanup({ keepReview: true, keepOcr: true, dryRun: false,
      extraPaths: [path.join(link, "_tmp_child")] }), /linked parent/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
    runCleanup({ keepReview: true, keepOcr: true, dryRun: false, extraPaths: [link] });
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
  } finally {
    fs.rmSync(local, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
