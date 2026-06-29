import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultSubjectPack = process.env.CLASSROOM_TOOLKIT_SUBJECT_PACK || "physics-answer";
const defaultSnapshotPath = path.join(repoRoot, ".snapshot-cache", "resolved-snapshot.json");

export function getDefaultSubjectPack() {
  return process.env.CLASSROOM_TOOLKIT_SUBJECT_PACK || defaultSubjectPack;
}

export function getRuntimeConfigPath(subjectPack = getDefaultSubjectPack()) {
  return path.join(repoRoot, "prompts", subjectPack, "config.json");
}

export function loadRuntimeConfig(subjectPack = getDefaultSubjectPack()) {
  const configPath = getRuntimeConfigPath(subjectPack);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Runtime config not found: ${configPath}`);
  }

  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function resolveRuntimeConfigRelativePath(relativePath, subjectPack = getDefaultSubjectPack()) {
  return path.resolve(path.dirname(getRuntimeConfigPath(subjectPack)), relativePath);
}

export function getDefaultSnapshotPath(subjectPack = getDefaultSubjectPack()) {
  const config = loadRuntimeConfig(subjectPack);
  if (config.snapshot?.cachePath) {
    return resolveRuntimeConfigRelativePath(config.snapshot.cachePath, subjectPack);
  }

  return defaultSnapshotPath;
}

export function resolveSnapshotPath(snapshotPath, options = {}) {
  const subjectPack = options.subjectPack ?? getDefaultSubjectPack();
  const callerCwd = options.callerCwd ?? process.cwd();

  if (typeof snapshotPath === "string" && snapshotPath.trim().length > 0) {
    return path.resolve(callerCwd, snapshotPath);
  }

  return getDefaultSnapshotPath(subjectPack);
}

export function loadResolvedSnapshot(snapshotPath = getDefaultSnapshotPath(), options = {}) {
  if (!fs.existsSync(snapshotPath)) {
    if (options.required) {
      throw new Error(`Resolved snapshot not found: ${snapshotPath}`);
    }

    return null;
  }

  return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
}

export function getDefaultProfileName(subjectPack = getDefaultSubjectPack()) {
  return loadRuntimeConfig(subjectPack).profiles?.default ?? "classroom";
}
