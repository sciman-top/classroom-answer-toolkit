import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultProfileName, loadResolvedSnapshot, loadRuntimeConfig } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const promptProfilesDir = path.join(repoRoot, "prompts", "physics-answer", "profiles");
const renderBaseProfilePath = path.join(repoRoot, "prompts", "platform-core", "profiles", "render-base.json");

export const DEFAULT_PROFILE_NAME = getDefaultProfileName();
const runtimeConfig = loadRuntimeConfig();
const resolvedSnapshot = loadResolvedSnapshot();

const defaultProfile = fs.existsSync(renderBaseProfilePath)
  ? JSON.parse(fs.readFileSync(renderBaseProfilePath, "utf8"))
  : {
      name: DEFAULT_PROFILE_NAME,
      page: {
        size: "A4",
        margin: {
          topMm: 16,
          rightMm: 17,
          bottomMm: 16,
          leftMm: 17
        }
      },
      typography: {
        fontFamily: '"Microsoft YaHei", "SimHei", "Noto Sans CJK SC", sans-serif',
        bodyFontSizePt: 14,
        lineHeight: 1.55,
        maxBodyWidthMm: 148,
        h1FontSizePt: 21,
        h1LineHeight: 1.25,
        h1MarginBottomPt: 9,
        h2FontSizePt: 16,
        h2LineHeight: 1.35,
        h2MarginTopPt: 15,
        h2MarginBottomPt: 7,
        paragraphMarginBottomPt: 7,
        katexScale: 1.04,
        displayMathMarginTopEm: 0.18,
        displayMathMarginBottomEm: 0.35
      },
      answerRules: {
        targetPlainTextCjkPerLine: runtimeConfig.profiles?.classroom?.plainTextCjkTarget ?? 20,
        maxPlainTextCjkPerLine: runtimeConfig.profiles?.classroom?.plainTextCjkMax ?? 24
      }
    };

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function resolveProfilePath(profileNameOrPath, callerCwd) {
  if (!profileNameOrPath || profileNameOrPath === DEFAULT_PROFILE_NAME) {
    const promptDefaultPath = path.join(promptProfilesDir, `${DEFAULT_PROFILE_NAME}.json`);
    if (fs.existsSync(promptDefaultPath)) {
      return promptDefaultPath;
    }
  }

  const promptBuiltInPath = path.join(promptProfilesDir, `${profileNameOrPath}.json`);
  if (fs.existsSync(promptBuiltInPath)) {
    return promptBuiltInPath;
  }

  return path.resolve(callerCwd, profileNameOrPath);
}

export function loadRenderProfile(profileNameOrPath, callerCwd = process.cwd(), snapshot = resolvedSnapshot) {
  if (snapshot && !profileNameOrPath?.includes?.(path.sep) && !String(profileNameOrPath ?? "").endsWith(".json")) {
    const profileName = profileNameOrPath || DEFAULT_PROFILE_NAME;
    const snapshotProfile = snapshot.profiles?.[profileName];
    if (snapshotProfile) {
      const mergedFromSnapshot = deepMerge(defaultProfile, snapshotProfile);
      mergedFromSnapshot.name = snapshotProfile.name ?? profileName;
      mergedFromSnapshot.profilePath = snapshot.snapshotId;
      mergedFromSnapshot.answerRules = deepMerge(defaultProfile.answerRules, snapshotProfile.answerRules ?? {});
      return mergedFromSnapshot;
    }
  }

  const profilePath = resolveProfilePath(profileNameOrPath, callerCwd);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Render profile not found: ${profileNameOrPath ?? DEFAULT_PROFILE_NAME}`);
  }

  const loaded = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const merged = deepMerge(defaultProfile, loaded);
  merged.name = loaded.name || path.basename(profilePath, path.extname(profilePath));
  merged.profilePath = profilePath;
  return merged;
}

export function listBuiltInProfiles() {
  const names = new Set();

  if (!fs.existsSync(promptProfilesDir)) {
    return [];
  }

  for (const entry of fs.readdirSync(promptProfilesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      names.add(path.basename(entry.name, ".json"));
    }
  }

  return [...names].sort();
}
