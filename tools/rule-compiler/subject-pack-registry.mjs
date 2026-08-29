import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDefaultOutputRelativePath } from "./compile-snapshot.mjs";
import { readJsonFile } from "./shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

// The platform's primary subject pack: sorts first and is the default
// selection for gates and the desktop shell. This is the single place that
// encodes that policy for PowerShell, Node, and the WPF health surface.
const primarySubjectPackAssetId = "junior-physics-answer";

function listSubjectPackDirectories(promptRoot) {
  if (!fs.existsSync(promptRoot)) {
    return [];
  }

  return fs
    .readdirSync(promptRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(promptRoot, name, "manifest.json")))
    .map((name) => path.join(promptRoot, name, "manifest.json"))
    .sort();
}

function resolvePackProfiles(config) {
  const defaultProfile = typeof config?.profiles?.default === "string" && config.profiles.default.trim().length > 0
    ? config.profiles.default
    : "classroom";

  const profileNames = config?.profiles && typeof config.profiles === "object"
    ? Object.keys(config.profiles).filter((name) => name !== "default")
    : [];

  if (profileNames.length === 0) {
    return { defaultProfile, profiles: [defaultProfile] };
  }
  return {
    defaultProfile,
    profiles: profileNames.includes(defaultProfile)
      ? [defaultProfile, ...profileNames.filter((name) => name !== defaultProfile)]
      : [defaultProfile, ...profileNames]
  };
}

function describeSubjectPack(manifestPath, repositoryRoot) {
  const manifest = readJsonFile(manifestPath);
  if (manifest?.kind !== "subject-pack" || typeof manifest.assetId !== "string" || manifest.assetId.length === 0) {
    return null;
  }

  const packRoot = path.dirname(manifestPath);
  const configRelativePath = typeof manifest?.sourceOfTruth?.runtimeConfig === "string"
    && manifest.sourceOfTruth.runtimeConfig.trim().length > 0
    ? manifest.sourceOfTruth.runtimeConfig
    : "./config.json";
  const configPath = path.resolve(packRoot, configRelativePath);
  const config = fs.existsSync(configPath) ? readJsonFile(configPath) : null;

  const { defaultProfile, profiles } = resolvePackProfiles(config);

  const evalDatasetRelativePath = typeof config?.evaluation?.dataset === "string"
    && config.evaluation.dataset.trim().length > 0
    ? config.evaluation.dataset
    : `../../eval/${manifest.assetId}/dataset.json`;
  const evalDatasetPath = path.resolve(path.dirname(configPath), evalDatasetRelativePath);

  const evalResultsRelativePath = typeof manifest?.evaluation?.resultsDir === "string"
    && manifest.evaluation.resultsDir.trim().length > 0
    ? manifest.evaluation.resultsDir
    : `../../eval/${manifest.assetId}/results`;
  const evalResultsPath = path.join(path.resolve(packRoot, evalResultsRelativePath), "latest.json");

  return {
    assetId: manifest.assetId,
    status: typeof manifest.status === "string" ? manifest.status : "",
    active: String(manifest.status ?? "").toLowerCase() === "active",
    primary: manifest.assetId === primarySubjectPackAssetId,
    manifestPath,
    configPath,
    defaultProfile,
    profiles,
    snapshotPath: path.resolve(repositoryRoot, resolveDefaultOutputRelativePath(manifest.assetId, repositoryRoot)),
    evalDatasetPath,
    evalResultsPath
  };
}

export function listSubjectPacks({ repositoryRoot = repoRoot } = {}) {
  const promptRoot = path.join(repositoryRoot, "prompts");
  return listSubjectPackDirectories(promptRoot)
    .map((manifestPath) => {
      try {
        return describeSubjectPack(manifestPath, repositoryRoot);
      } catch (error) {
        throw new Error(`Unable to read subject pack manifest ${manifestPath}: ${error.message}`);
      }
    })
    .filter((pack) => pack !== null)
    .sort((left, right) =>
      Number(right.active) - Number(left.active)
      || Number(right.primary) - Number(left.primary)
      || left.assetId.localeCompare(right.assetId));
}

// Mirrors scripts/subject-pack-tooling.ps1 Get-SubjectPackSnapshotOutputPath:
// the default profile compiles to the pack's canonical snapshot path; every
// other profile inserts its name before the extension. Gates, bootstrap, and
// eval must all land on these same files so a validated snapshot cannot drift
// from the one delivery consumes.
export function resolveProfileSnapshotRelativePath(subjectPack, profile, repositoryRoot = repoRoot) {
  const manifestPath = path.join(repositoryRoot, "prompts", String(subjectPack), "manifest.json");
  const pack = describeSubjectPack(manifestPath, repositoryRoot);
  const snapshotRelativePath = path.relative(repositoryRoot, pack.snapshotPath);
  if (profile === pack.defaultProfile) {
    return snapshotRelativePath;
  }
  const extension = path.extname(snapshotRelativePath);
  const baseName = path.basename(snapshotRelativePath, extension);
  return path.join(path.dirname(snapshotRelativePath), `${baseName}.${profile}${extension}`);
}

export { primarySubjectPackAssetId };
