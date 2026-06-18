import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultProfileName, getDefaultSubjectPack, loadRuntimeConfig } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const renderBaseProfilePath = path.join(repoRoot, "prompts", "platform-core", "profiles", "render-base.json");

export const DEFAULT_PROFILE_NAME = getDefaultProfileName(getDefaultSubjectPack());

function loadRenderBaseProfile() {
  if (fs.existsSync(renderBaseProfilePath)) {
    return JSON.parse(fs.readFileSync(renderBaseProfilePath, "utf8"));
  }

  return {
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
      targetPlainTextCjkPerLine: 20,
      maxPlainTextCjkPerLine: 24
    }
  };
}

function getPromptProfilesDir(subjectPack = getDefaultSubjectPack()) {
  return path.join(repoRoot, "prompts", subjectPack, "profiles");
}

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

function buildDefaultProfile(subjectPack = getDefaultSubjectPack()) {
  const runtimeConfig = loadRuntimeConfig(subjectPack);
  const baseProfile = loadRenderBaseProfile();
  const defaultProfileName = getDefaultProfileName(subjectPack);
  const defaultProfileConfig = runtimeConfig.profiles?.[defaultProfileName]
    ?? runtimeConfig.profiles?.classroom
    ?? {};

  return deepMerge(baseProfile, {
    name: defaultProfileName,
    answerRules: {
      targetPlainTextCjkPerLine:
        defaultProfileConfig.plainTextCjkTarget
        ?? baseProfile.answerRules?.targetPlainTextCjkPerLine
        ?? 20,
      maxPlainTextCjkPerLine:
        defaultProfileConfig.plainTextCjkMax
        ?? baseProfile.answerRules?.maxPlainTextCjkPerLine
        ?? 24
    }
  });
}

function resolveProfilePath(profileNameOrPath, callerCwd, subjectPack, defaultProfileName) {
  const promptProfilesDir = getPromptProfilesDir(subjectPack);

  if (!profileNameOrPath || profileNameOrPath === defaultProfileName) {
    const promptDefaultPath = path.join(promptProfilesDir, `${defaultProfileName}.json`);
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

export function loadRenderProfile(profileNameOrPath, callerCwd = process.cwd(), snapshot = null, subjectPack = getDefaultSubjectPack()) {
  const defaultProfileName = getDefaultProfileName(subjectPack);
  const defaultProfile = buildDefaultProfile(subjectPack);

  if (snapshot && !profileNameOrPath?.includes?.(path.sep) && !String(profileNameOrPath ?? "").endsWith(".json")) {
    const profileName = profileNameOrPath || defaultProfileName;
    const snapshotProfile = snapshot.profiles?.[profileName];
    if (snapshotProfile) {
      const mergedFromSnapshot = deepMerge(defaultProfile, snapshotProfile);
      mergedFromSnapshot.name = snapshotProfile.name ?? profileName;
      mergedFromSnapshot.profilePath = snapshot.snapshotId;
      mergedFromSnapshot.answerRules = deepMerge(defaultProfile.answerRules, snapshotProfile.answerRules ?? {});
      return mergedFromSnapshot;
    }
  }

  const profilePath = resolveProfilePath(profileNameOrPath, callerCwd, subjectPack, defaultProfileName);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Render profile not found: ${profileNameOrPath ?? defaultProfileName}`);
  }

  const loaded = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const merged = deepMerge(defaultProfile, loaded);
  merged.name = loaded.name || path.basename(profilePath, path.extname(profilePath));
  merged.profilePath = profilePath;
  return merged;
}

export function listBuiltInProfiles(subjectPack = getDefaultSubjectPack()) {
  const names = new Set();
  const promptProfilesDir = getPromptProfilesDir(subjectPack);

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
