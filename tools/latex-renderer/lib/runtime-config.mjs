import fs from "node:fs";
import path from "node:path";
import { getDefaultSubjectPackName, normalizeSubjectPackName } from "../../rule-compiler/shared.mjs";
import { repositoryRoot as repoRoot } from "../../shared.mjs";
import {
  listSubjectPacks,
  resolveProfileSnapshotRelativePath
} from "../../rule-compiler/subject-pack-registry.mjs";

export { getDefaultSubjectPackName };

export function getDefaultSnapshotPath(subjectPack = getDefaultSubjectPackName(), profile = null) {
  const canonicalSubjectPack = normalizeSubjectPackName(subjectPack, getDefaultSubjectPackName());
  const pack = listSubjectPacks({ repositoryRoot: repoRoot })
    .find((candidate) => candidate.assetId === canonicalSubjectPack);
  const resolvedProfile = profile ?? pack?.defaultProfile ?? "classroom";
  // The registry owns both the pack cache layout and profile suffix policy.
  return path.join(
    repoRoot,
    resolveProfileSnapshotRelativePath(canonicalSubjectPack, resolvedProfile, repoRoot)
  );
}

export function resolveSnapshotPath(snapshotPath, options = {}) {
  const subjectPack = normalizeSubjectPackName(options.subjectPack, getDefaultSubjectPackName());
  const callerCwd = options.callerCwd ?? process.cwd();

  if (typeof snapshotPath === "string" && snapshotPath.trim().length > 0) {
    return path.resolve(callerCwd, snapshotPath);
  }

  return getDefaultSnapshotPath(subjectPack, options.profile ?? null);
}

export function loadRequiredResolvedSnapshot(snapshotPath = getDefaultSnapshotPath()) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Resolved snapshot not found: ${snapshotPath}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
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
