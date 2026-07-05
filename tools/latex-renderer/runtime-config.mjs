import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultSubjectPackName, normalizeSubjectPackName } from "../rule-compiler/shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultSubjectPack = getDefaultSubjectPackName();
const defaultSnapshotPath = path.join(repoRoot, ".snapshot-cache", "resolved-snapshot.json");

function getDefaultSnapshotFileName(subjectPack) {
  const canonicalSubjectPack = normalizeSubjectPackName(subjectPack, defaultSubjectPack);
  if (canonicalSubjectPack === "junior-physics-answer") {
    return "resolved-snapshot.json";
  }

  const normalizedSubjectPack = String(canonicalSubjectPack ?? "")
    .trim()
    .replace(/-answer$/u, "");

  return normalizedSubjectPack
    ? `resolved-snapshot.${normalizedSubjectPack}.json`
    : "resolved-snapshot.json";
}

export function getDefaultSubjectPack() {
  return getDefaultSubjectPackName();
}

export function getDefaultSnapshotPath(subjectPack = getDefaultSubjectPack()) {
  const snapshotFileName = getDefaultSnapshotFileName(subjectPack);
  if (snapshotFileName === "resolved-snapshot.json") {
    return defaultSnapshotPath;
  }

  return path.join(repoRoot, ".snapshot-cache", snapshotFileName);
}

export function resolveSnapshotPath(snapshotPath, options = {}) {
  const subjectPack = normalizeSubjectPackName(options.subjectPack, getDefaultSubjectPack());
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

export function loadRequiredResolvedSnapshot(snapshotPath, options = {}) {
  const snapshot = loadResolvedSnapshot(snapshotPath, { ...options, required: true });
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`Resolved snapshot is not a JSON object: ${snapshotPath}`);
  }

  return snapshot;
}

export function getSnapshotActiveProfile(snapshot, requestedProfile = null) {
  const activeProfile = snapshot?.activeProfile;
  if (!activeProfile || typeof activeProfile !== "object" || Array.isArray(activeProfile)) {
    throw new Error("Resolved snapshot is missing activeProfile.");
  }

  const activeProfileName = activeProfile.name;
  if (typeof activeProfileName !== "string" || activeProfileName.trim().length === 0) {
    throw new Error("Resolved snapshot is missing activeProfile.name.");
  }

  if (
    typeof requestedProfile === "string"
    && requestedProfile.trim().length > 0
    && requestedProfile !== activeProfileName
  ) {
    throw new Error(`Requested profile "${requestedProfile}" does not match snapshot activeProfile "${activeProfileName}".`);
  }

  return activeProfile;
}

export function listSnapshotProfileNames(snapshot) {
  return Object.keys(snapshot?.profiles ?? {}).sort();
}
