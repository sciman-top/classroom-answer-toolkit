import fs from "node:fs";
import path from "node:path";

// Windows AV/indexer/preview handlers hold freshly written files for short
// moments; a delete that throws EPERM/EACCES/EBUSY there fails an otherwise
// healthy run (e.g. deliver clearing last run's review images while a viewer
// still has one open). The short bounded backoff mirrors renameWithRetry in
// atomic-write.mjs. Retries restart from the top: removal is idempotent, so
// the already-deleted prefix costs only existsSync calls.
const MAX_DELETE_ATTEMPTS = 5;

function removePathOnce(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return;
  }

  for (const entry of fs.readdirSync(targetPath)) {
    removePathOnce(path.join(targetPath, entry));
  }
  fs.rmdirSync(targetPath);
}

export function removePathRecursive(targetPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      removePathOnce(targetPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : null;
      if ((code === "EPERM" || code === "EACCES" || code === "EBUSY")
        && attempt < MAX_DELETE_ATTEMPTS - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}
