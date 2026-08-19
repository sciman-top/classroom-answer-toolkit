import fs from "node:fs";
import path from "node:path";

export function removePathRecursive(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return;
  }

  for (const entry of fs.readdirSync(targetPath)) {
    removePathRecursive(path.join(targetPath, entry));
  }
  fs.rmdirSync(targetPath);
}
