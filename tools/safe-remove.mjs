import fs from "node:fs";

// Windows AV/indexer/preview handlers hold freshly written files for short
// moments; a delete that throws EACCES there fails an otherwise healthy run
// (e.g. deliver clearing last run's review images while a viewer still has
// one open). fs.rmSync already retries EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM;
// the outer loop covers EACCES, which rmSync does not retry.
const MAX_DELETE_ATTEMPTS = 5;

export function removePathRecursive(targetPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      return;
    } catch (error) {
      if (error && error.code === "EACCES" && attempt < MAX_DELETE_ATTEMPTS - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}
