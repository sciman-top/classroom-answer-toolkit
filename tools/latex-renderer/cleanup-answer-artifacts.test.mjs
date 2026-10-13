import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "../shared.mjs";
import { runCleanup } from "./cleanup-answer-artifacts.mjs";

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
