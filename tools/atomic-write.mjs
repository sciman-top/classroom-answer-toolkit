import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeTextFileAtomic(filePath, content) {
  const resolvedPath = path.resolve(filePath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    fs.renameSync(temporaryPath, resolvedPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
