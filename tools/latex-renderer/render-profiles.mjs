import { deepMerge } from "../shared.mjs";
import { getSnapshotActiveProfile, listSnapshotProfileNames } from "./runtime-config.mjs";

const fallbackRenderProfile = {
  name: "classroom",
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

export function loadRenderProfile(profileNameOrPath, snapshot = null) {
  if (!snapshot) {
    throw new Error("Resolved snapshot is required to load a render profile.");
  }

  const activeProfile = getSnapshotActiveProfile(snapshot, profileNameOrPath);
  const merged = deepMerge(fallbackRenderProfile, activeProfile);
  merged.name = activeProfile.name;
  merged.profilePath = snapshot.snapshotId;
  merged.answerRules = deepMerge(fallbackRenderProfile.answerRules, activeProfile.answerRules ?? {});
  return merged;
}

export function listBuiltInProfiles(_subjectPack = null, snapshot = null) {
  return snapshot ? listSnapshotProfileNames(snapshot) : [];
}
