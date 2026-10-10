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

export function renameWithRetry(temporaryPath, targetPath) {
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

// A rename is only durable once the directory entry itself is flushed. On
// Windows fsync on a directory handle is not supported, so this is best effort:
// a failure here must never turn a successful replace into an error.
function flushDirectory(directory) {
  let handle;
  try {
    handle = fs.openSync(directory, "r");
    fs.fsyncSync(handle);
  } catch {
    // Unsupported on this platform or filesystem; the rename already happened.
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // Ignore: the descriptor is released when the process exits.
      }
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

  let replaceError = null;
  try {
    writeFileSyncDurable(temporaryPath, content);
    renameWithRetry(temporaryPath, resolvedPath);
    flushDirectory(directory);
  } catch (error) {
    // Surface the replace failure, not the cleanup failure: the same AV lock
    // that broke the rename usually holds the temp file too, and a throw from
    // finally would mask the actionable cause.
    replaceError = error;
  } finally {
    try {
      removePathRecursive(temporaryPath);
    } catch {
      // The temp file carries a unique name and no consumer reads it; leaving
      // it behind is inert.
    }
  }
  if (replaceError !== null) {
    throw replaceError;
  }
}
