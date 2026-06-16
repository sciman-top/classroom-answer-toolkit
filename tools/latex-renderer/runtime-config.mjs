import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultConfigPath = path.join(repoRoot, "prompts", "physics-answer", "config.json");

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

export function getDefaultProfileName() {
  return loadRuntimeConfig().profiles?.default ?? "classroom";
}
