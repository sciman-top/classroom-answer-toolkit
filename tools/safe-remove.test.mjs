import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removePathRecursive } from "./safe-remove.mjs";

test("removePathRecursive deletes nested trees and stops at nothing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-remove-tree-"));
  try {
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "leaf.txt"), "x");
    fs.writeFileSync(path.join(root, "top.txt"), "y");

    removePathRecursive(root);
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removePathRecursive is a no-op for missing paths", () => {
  const missing = path.join(os.tmpdir(), `safe-remove-missing-${process.pid}-${Date.now()}`);
  assert.doesNotThrow(() => removePathRecursive(missing));
});

function canCreateSymlinks() {
  // Windows needs admin or Developer Mode for directory symlinks; probe once
  // instead of assuming.
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "safe-remove-probe-"));
  try {
    const target = path.join(probeRoot, "t");
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(probeRoot, "l"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

test("removePathRecursive removes a symlink itself, not its target", { skip: canCreateSymlinks() ? false : "symlink creation not permitted on this host" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-remove-link-"));
  try {
    const target = path.join(root, "target-dir");
    const link = path.join(root, "link");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.txt"), "kept");
    fs.symlinkSync(target, link, "dir");

    removePathRecursive(link);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(target, "keep.txt")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
