import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeTextFileAtomic } from "../atomic-write.mjs";
import { sha256Hex } from "../shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const subjectPackAliases = new Map([
  ["physics-answer", "junior-physics-answer"]
]);
const subjectPackNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function normalizeSubjectPackName(subjectPack, fallback = "junior-physics-answer") {
  if (typeof subjectPack !== "string" || subjectPack.trim().length === 0) {
    return fallback;
  }

  const trimmed = subjectPack.trim();
  const canonical = subjectPackAliases.get(trimmed) ?? trimmed;

  // The value is concatenated into repository paths such as
  // prompts/<pack>/manifest.json, so an unvalidated name ("../../x") would read
  // and write outside the repository. Subject pack ids are kebab-case only.
  if (!subjectPackNamePattern.test(canonical)) {
    throw new Error(
      `Invalid subject pack id: ${JSON.stringify(subjectPack)}. Expected lowercase kebab-case, e.g. "junior-physics-answer".`
    );
  }

  return canonical;
}

export function getDefaultSubjectPackName() {
  return normalizeSubjectPackName(process.env.CLASSROOM_TOOLKIT_SUBJECT_PACK || "junior-physics-answer");
}

export function resolveRepoPath(relativePath) {
  return path.resolve(repoRoot, relativePath);
}

export function readJsonFile(filePath) {
  // Tolerate a UTF-8 BOM (e.g. an editor or Windows PowerShell 5.1 rewrite):
  // JSON.parse rejects it with a misleading "Unexpected token" error.
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

export function writeJsonFile(filePath, value) {
  writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  return `snapshot-${sha256Hex(stableStringify(payload)).slice(0, 16)}`;
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
