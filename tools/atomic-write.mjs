import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { removePathRecursive } from "./safe-remove.mjs";

function writeFileSyncDurable(targetPath, content) {
  const handle = fs.openSync(targetPath, "w");
  try {
    fs.writeFileSync(handle, content, "utf8");
    // Flush before the rename so a crash cannot leave a zero-filled target.
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function renameWithRetry(temporaryPath, targetPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporaryPath, targetPath);
      return;
    } catch (error) {
      // Windows readers (AV, indexers, preview handlers) can hold the target
      // briefly; short backoff beats failing an otherwise fine atomic replace.
      if ((error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY")
        && attempt < 5) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

export function writeTextFileAtomic(filePath, content) {
  const resolvedPath = path.resolve(filePath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  try {
    writeFileSyncDurable(temporaryPath, content);
    renameWithRetry(temporaryPath, resolvedPath);
  } finally {
    removePathRecursive(temporaryPath);
  }
}
