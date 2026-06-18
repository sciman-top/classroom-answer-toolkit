import fs from "node:fs";
import path from "node:path";
import { createSnapshotId, listJsonFiles, readJsonFile, resolveRepoPath, writeJsonFile } from "./shared.mjs";

export function loadRulePackFiles(directoryRelativePath) {
  const directoryPath = resolveRepoPath(directoryRelativePath);
  return listJsonFiles(directoryPath).map((filePath) => readJsonFile(filePath));
}

export function mergeRulePacks(packs) {
  const rules = [];
  const seen = new Set();

  for (const pack of packs) {
    for (const rule of pack.rules ?? []) {
      if (seen.has(rule.id)) {
        throw new Error(`Duplicate rule id: ${rule.id}`);
      }
      seen.add(rule.id);
      rules.push(rule);
    }
  }

  rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.id).localeCompare(String(b.id)));
  return rules;
}

export function mergeProfiles(profileFiles) {
  const profilesByPath = new Map();
  const aliases = new Map();

  for (const profileFile of profileFiles) {
    const profile = profileFile.profile;
    profilesByPath.set(profileFile.relativePath, profile);
    aliases.set(profileFile.relativePath, profileFile.relativePath);
    aliases.set(profileFile.name, profileFile.relativePath);
    aliases.set(profileFile.baseName, profileFile.relativePath);
  }

  return { profilesByPath, aliases };
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

function listProfileFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(directoryPath, entry.name);
      const profile = readJsonFile(filePath);
      return {
        filePath,
        relativePath: path.relative(resolveRepoPath("."), filePath).replace(/\\/g, "/"),
        baseName: path.basename(entry.name, ".json"),
        name: profile.name ?? path.basename(entry.name, ".json"),
        profile
      };
    });
}

function normalizeInheritedProfileKey(inheritRef, currentProfileKey) {
  if (!inheritRef) {
    return null;
  }

  const normalized = inheritRef.replace(/\\/g, "/");
  if (normalized.endsWith(".json")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(currentProfileKey), normalized));
  }
  return path.basename(normalized, ".json");
}

function resolveProfileInheritance(profileKey, profileGraph, seen = new Set()) {
  if (seen.has(profileKey)) {
    throw new Error(`Circular profile inheritance detected: ${[...seen, profileKey].join(" -> ")}`);
  }

  const resolvedKey = profileGraph.aliases.get(profileKey) ?? profileKey;
  const profile = profileGraph.profilesByPath.get(resolvedKey);
  if (!profile) {
    throw new Error(`Profile not found during inheritance resolution: ${profileKey}`);
  }

  const inheritRefs = profile.inherits ?? [];
  if (!inheritRefs.length) {
    return { ...profile };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(resolvedKey);

  let mergedBase = {};
  for (const inheritRef of inheritRefs) {
    const inheritedKey = normalizeInheritedProfileKey(inheritRef, resolvedKey);
    const inheritedResolvedKey = profileGraph.aliases.get(inheritedKey) ?? inheritedKey;
    if (!inheritedKey || !profileGraph.profilesByPath.has(inheritedResolvedKey)) {
      continue;
    }
    mergedBase = deepMerge(mergedBase, resolveProfileInheritance(inheritedResolvedKey, profileGraph, nextSeen));
  }

  return deepMerge(mergedBase, profile);
}

export function buildMergedAssets(options = {}) {
  const subjectPack = options.subjectPack ?? "physics-answer";
  const subjectRoot = `prompts/${subjectPack}`;
  const platformManifest = readJsonFile(resolveRepoPath(options.platformManifest ?? "prompts/platform-core/manifest.json"));
  const subjectManifestPath = options.subjectManifest ?? `${subjectRoot}/manifest.json`;
  const subjectConfigPath = options.subjectConfig ?? `${subjectRoot}/config.json`;
  const subjectManifest = readJsonFile(resolveRepoPath(subjectManifestPath));
  const subjectConfig = readJsonFile(resolveRepoPath(subjectConfigPath));

  const platformRulePacks = loadRulePackFiles(options.platformRulesDir ?? "prompts/platform-core/rules");
  const subjectRulesDir = options.subjectRulesDir ?? `${subjectRoot}/rules`;
  const subjectProfilesDirPath = options.subjectProfilesDir ?? `${subjectRoot}/profiles`;
  const subjectRulePacks = loadRulePackFiles(subjectRulesDir);
  const platformProfilesDir = resolveRepoPath(options.platformProfilesDir ?? "prompts/platform-core/profiles");
  const subjectProfilesDir = resolveRepoPath(subjectProfilesDirPath);

  const profileFiles = [
    ...listProfileFiles(platformProfilesDir),
    ...listProfileFiles(subjectProfilesDir)
  ];

  const rules = mergeRulePacks([...platformRulePacks, ...subjectRulePacks]);
  const profileGraph = mergeProfiles(profileFiles);

  const subjectProfileDefaults = subjectConfig.profiles ?? {};
  const resolvedProfiles = Object.fromEntries(
    listProfileFiles(subjectProfilesDir).map((profileFile) => {
      const name = profileFile.name;
      const profile = resolveProfileInheritance(profileFile.relativePath, profileGraph);
      return [
      name,
      {
        ...profile,
        layout: {
          ...profile.layout,
          plainTextCjkTarget: profile.layout?.plainTextCjkTarget ?? subjectProfileDefaults[name]?.plainTextCjkTarget,
          plainTextCjkMax: profile.layout?.plainTextCjkMax ?? subjectProfileDefaults[name]?.plainTextCjkMax
        },
        answerRules: {
          ...profile.answerRules,
          targetPlainTextCjkPerLine: profile.answerRules?.targetPlainTextCjkPerLine ?? profile.layout?.plainTextCjkTarget ?? subjectProfileDefaults[name]?.plainTextCjkTarget,
          maxPlainTextCjkPerLine: profile.answerRules?.maxPlainTextCjkPerLine ?? profile.layout?.plainTextCjkMax ?? subjectProfileDefaults[name]?.plainTextCjkMax
        }
      }
    ];
    })
  );

  return {
    manifest: {
      platform: platformManifest,
      subject: subjectManifest
    },
    config: subjectConfig,
    refs: {
      subjectManifest: subjectManifestPath,
      subjectConfig: subjectConfigPath,
      subjectRulesDir,
      subjectProfilesDir: subjectProfilesDirPath
    },
    rules,
    profiles: resolvedProfiles
  };
}

export function compileResolvedSnapshot(options = {}) {
  const assets = buildMergedAssets(options);
  const activeProfileName = options.profileName ?? assets.config.profiles?.default ?? "classroom";
  const activeProfile = assets.profiles[activeProfileName];
  if (!activeProfile) {
    throw new Error(`Profile not found: ${activeProfileName}`);
  }

  const snapshotCore = {
    layers: {
      platformCore: assets.manifest.platform.version,
      subjectPack: assets.manifest.subject.version
    },
    subjectPack: assets.manifest.subject,
    activeProfile,
    rules: assets.rules,
    profiles: assets.profiles,
    toolchain: {
      compiler: "tools/rule-compiler/compile-snapshot.mjs"
    },
    inputRefs: {
      subjectManifest: assets.refs.subjectManifest,
      subjectConfig: assets.refs.subjectConfig,
      subjectRulesDir: assets.refs.subjectRulesDir,
      subjectProfilesDir: assets.refs.subjectProfilesDir
    },
    meta: {
      ruleCount: assets.rules.length,
      profileCount: Object.keys(assets.profiles).length
    }
  };

  const snapshotId = createSnapshotId(snapshotCore);
  return {
    snapshotId,
    generatedAt: new Date().toISOString(),
    ...snapshotCore
  };
}

export function writeResolvedSnapshot(snapshot, outputRelativePath) {
  const outputPath = resolveRepoPath(outputRelativePath);
  writeJsonFile(outputPath, snapshot);
  return outputPath;
}
