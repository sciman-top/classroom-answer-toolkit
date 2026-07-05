import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const subjectPackAliases = new Map([
  ["physics-answer", "junior-physics-answer"]
]);

export function normalizeSubjectPackName(subjectPack, fallback = "junior-physics-answer") {
  if (typeof subjectPack !== "string" || subjectPack.trim().length === 0) {
    return fallback;
  }

  const trimmed = subjectPack.trim();
  return subjectPackAliases.get(trimmed) ?? trimmed;
}

export function getDefaultSubjectPackName() {
  return normalizeSubjectPackName(process.env.CLASSROOM_TOOLKIT_SUBJECT_PACK || "junior-physics-answer");
}

export function resolveRepoPath(relativePath) {
  return path.resolve(repoRoot, relativePath);
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function stableStringify(value) {
  const sortValue = (input) => {
    if (Array.isArray(input)) {
      return input.map(sortValue);
    }

    if (input && typeof input === "object") {
      return Object.keys(input)
        .sort()
        .reduce((acc, key) => {
          acc[key] = sortValue(input[key]);
          return acc;
        }, {});
    }

    return input;
  };

  return JSON.stringify(sortValue(value));
}

export function createSnapshotId(payload) {
  return `snapshot-${crypto.createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 16)}`;
}

export function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJsonFile(filePath) : null;
}

export function listJsonFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}
