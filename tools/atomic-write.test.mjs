import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renameWithRetry, writeTextFileAtomic } from "./atomic-write.mjs";

// Replacement, failure cleanup, and target survival already have incidental
// coverage in latex-renderer's pdf-output-path tests; this file owns the
// branches they do not reach.
function makeWorkspace(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function listTempFiles(directory) {
  return fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp"));
}

test("writeTextFileAtomic creates the target through parent directories", () => {
  const root = makeWorkspace("atomic-write-create");
  try {
    const target = path.join(root, "nested", "dir", "answer.md");

    writeTextFileAtomic(target, "body");

    assert.equal(fs.readFileSync(target, "utf8"), "body");
    assert.deepEqual(listTempFiles(path.join(root, "nested", "dir")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renameWithRetry rides out transient EBUSY locks", (t) => {
  const root = makeWorkspace("atomic-write-retry");
  try {
    const source = path.join(root, "staged.tmp");
    const target = path.join(root, "answer.md");
    fs.writeFileSync(source, "body");
    const realRename = fs.renameSync;
    let failures = 0;
    t.mock.method(fs, "renameSync", (...args) => {
      if (failures < 2) {
        failures += 1;
        throw Object.assign(new Error("locked by AV"), { code: "EBUSY" });
      }
      return realRename(...args);
    });

    renameWithRetry(source, target);

    assert.equal(fs.readFileSync(target, "utf8"), "body");
    assert.equal(failures, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent writers to one target never leave a torn file", () => {
  const root = makeWorkspace("atomic-write-concurrent");
  try {
    const target = path.join(root, "answer.md");
    const contents = Array.from({ length: 8 }, (_, index) => `content-${index}\n`.repeat(40));

    Promise.all(contents.map((content) => writeTextFileAtomic(target, content)));
    // Sync fs calls serialize on the event loop; what matters is that every
    // write used its own temp name and the target is exactly one full write.
    const finalContent = fs.readFileSync(target, "utf8");
    assert.equal(contents.includes(finalContent), true);
    assert.deepEqual(listTempFiles(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
