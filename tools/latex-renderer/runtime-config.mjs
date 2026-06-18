import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultConfigPath = path.join(repoRoot, "prompts", "physics-answer", "config.json");
const defaultSnapshotPath = path.join(repoRoot, ".snapshot-cache", "resolved-snapshot.json");

export function loadRuntimeConfig() {
  if (!fs.existsSync(defaultConfigPath)) {
    throw new Error(`Runtime config not found: ${defaultConfigPath}`);
  }

  return JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
}

export function getRuntimeConfigPath() {
  return defaultConfigPath;
}

export function resolveRuntimeConfigRelativePath(relativePath) {
  return path.resolve(path.dirname(defaultConfigPath), relativePath);
}

export function getDefaultSnapshotPath() {
  const config = loadRuntimeConfig();
  if (config.snapshot?.cachePath) {
    return resolveRuntimeConfigRelativePath(config.snapshot.cachePath);
  }

  return defaultSnapshotPath;
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

export function getDefaultProfileName() {
  return loadRuntimeConfig().profiles?.default ?? "classroom";
}
