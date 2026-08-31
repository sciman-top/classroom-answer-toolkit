import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listSubjectPacks, primarySubjectPackAssetId } from "./subject-pack-registry.mjs";
import { parseArgvFlags } from "../shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

const SPEC_VERSION_PATTERN = /(?:^|[-_])v(\d+\.\d+)(?:[-_]|\.md$)/;

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseSpecVersionFromPath(fileName) {
  const match = SPEC_VERSION_PATTERN.exec(fileName ?? "");
  return match ? match[1] : null;
}

function readHumanSpecVersion(manifest) {
  const humanSpec = manifest?.sourceOfTruth?.humanSpec;
  if (typeof humanSpec !== "string" || humanSpec.trim().length === 0) {
    return null;
  }
  return parseSpecVersionFromPath(humanSpec);
}

function readSnapshotStatus(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) {
    return { exists: false, id: null, version: null, profile: null };
  }
  const snapshot = tryReadJson(snapshotPath);
  if (!snapshot) {
    return { exists: true, id: null, version: null, profile: null };
  }
  return {
    exists: true,
    id: typeof snapshot.snapshotId === "string" ? snapshot.snapshotId : null,
    version: typeof snapshot.subjectPack?.version === "string" ? snapshot.subjectPack.version : null,
    profile: typeof snapshot.activeProfile?.name === "string" ? snapshot.activeProfile.name : null
  };
}

function readEvalSnapshotId(evalResult, profile) {
  if (typeof profile !== "string" || !Array.isArray(evalResult?.cases)) {
    return null;
  }
  for (const evalCase of evalResult.cases) {
    const snapshotId = evalCase?.profiles?.[profile]?.actual?.snapshot?.snapshotId;
    if (typeof snapshotId === "string") {
      return snapshotId;
    }
  }
  return null;
}

function readEvalStatus(evalResultsPath, profile) {
  if (!fs.existsSync(evalResultsPath)) {
    return { exists: false, ok: false, assetVersion: null, caseCount: 0, snapshotId: null };
  }
  const evalResult = tryReadJson(evalResultsPath);
  if (!evalResult) {
    return { exists: true, ok: false, assetVersion: null, caseCount: 0, snapshotId: null };
  }
  return {
    exists: true,
    ok: evalResult.ok === true,
    assetVersion: typeof evalResult.assetVersion === "string" ? evalResult.assetVersion : null,
    caseCount: Array.isArray(evalResult.cases) ? evalResult.cases.length : 0,
    snapshotId: readEvalSnapshotId(evalResult, profile)
  };
}

export function buildWorkspaceHealthReport({ subjectPack: requestedSubjectPack, repositoryRoot = repoRoot } = {}) {
  const issues = [];
  const isPackagedRuntime = fs.existsSync(path.join(repositoryRoot, "runtime-manifest.json"));
  let packs;
  try {
    packs = listSubjectPacks({ repositoryRoot });
  } catch (error) {
    // The registry is fail-closed for gates; the health surface degrades to a
    // diagnostic report instead so the shell keeps showing what broke.
    return {
      primarySubjectPack: primarySubjectPackAssetId,
      subjectPacks: [],
      latestProductionSpecVersion: null,
      assetVersion: null,
      snapshotExists: false,
      snapshotPath: path.join(repositoryRoot, ".snapshot-cache", "resolved-snapshot.json"),
      snapshotVersion: null,
      snapshotProfile: null,
      evalExists: false,
      evalOk: false,
      evalCaseCount: 0,
      summary: `无法读取 subject pack 注册表：${error.message}`,
      issues: [`无法读取 subject pack 注册表：${error.message}`]
    };
  }
  const pack = typeof requestedSubjectPack === "string" && requestedSubjectPack.trim().length > 0
    ? packs.find((candidate) => candidate.assetId.toLowerCase() === requestedSubjectPack.toLowerCase())
    : packs[0];
  if (requestedSubjectPack && !pack) {
    issues.push(`未发现 subject pack: ${requestedSubjectPack}。`);
  }

  const manifest = pack ? tryReadJson(pack.manifestPath) : null;
  const latestVersion = manifest ? readHumanSpecVersion(manifest) : null;
  const manifestVersion = typeof manifest?.version === "string" ? manifest.version : null;
  const snapshotStatus = readSnapshotStatus(pack?.snapshotPath ?? "");
  const evalStatus = readEvalStatus(pack?.evalResultsPath ?? "", snapshotStatus.profile);

  if (!pack) {
    issues.push("未发现有效的 subject pack manifest。");
  }
  if (latestVersion === null) {
    issues.push("主 subject pack 的人类规范文件名缺少可识别版本。");
  }
  if (manifestVersion === null) {
    issues.push("主 subject pack manifest 缺少 version。");
  }
  if (latestVersion !== null && manifestVersion !== null && manifestVersion !== `v${latestVersion}`) {
    issues.push(`最新规范 v${latestVersion} 与资产版本 ${manifestVersion} 不一致。`);
  }
  if (!snapshotStatus.exists) {
    issues.push("主 subject pack 的 snapshot 尚未生成。");
  } else if (snapshotStatus.version !== null && manifestVersion !== null && snapshotStatus.version !== manifestVersion) {
    issues.push(`snapshot 版本 ${snapshotStatus.version} 与资产版本 ${manifestVersion} 不一致。`);
  } else if (snapshotStatus.id === null || snapshotStatus.version === null || snapshotStatus.profile === null) {
    issues.push("主 subject pack 的 snapshot 缺少 id、version 或 active profile。");
  }
  if (!isPackagedRuntime) {
    if (!evalStatus.exists) {
      issues.push("评测结果 latest.json 尚未生成。");
    } else if (!evalStatus.ok) {
      issues.push("固定回归未全部通过。");
    } else if (evalStatus.assetVersion === null || evalStatus.caseCount <= 0) {
      issues.push("固定回归结果缺少 assetVersion 或有效 cases。");
    } else if (manifestVersion !== null && evalStatus.assetVersion !== manifestVersion) {
      issues.push(`评测结果版本 ${evalStatus.assetVersion} 与资产版本 ${manifestVersion} 不一致。`);
    } else if (snapshotStatus.id !== null && evalStatus.snapshotId !== snapshotStatus.id) {
      issues.push(evalStatus.snapshotId === null
        ? "评测结果未绑定当前 snapshot。"
        : `评测结果 snapshot ${evalStatus.snapshotId} 与当前 snapshot ${snapshotStatus.id} 不一致。`);
    }
  }

  const uniqueIssues = [...new Set(issues)];
  const summary = uniqueIssues.length === 0
    ? "规则快照、评测结果与最新规范已对齐。"
    : uniqueIssues.join("；");

  return {
    primarySubjectPack: pack?.assetId ?? primarySubjectPackAssetId,
    subjectPacks: packs.map((candidate) => candidate.assetId),
    latestProductionSpecVersion: latestVersion === null ? null : `v${latestVersion}`,
    assetVersion: manifestVersion,
    snapshotExists: snapshotStatus.exists,
            snapshotPath: pack?.snapshotPath ?? path.join(repositoryRoot, ".snapshot-cache", "resolved-snapshot.json"),
    snapshotVersion: snapshotStatus.version,
    snapshotProfile: snapshotStatus.profile,
    evalExists: evalStatus.exists,
    evalOk: evalStatus.ok,
    evalCaseCount: evalStatus.caseCount,
    summary,
    issues: uniqueIssues
  };
}

function main() {
  const options = parseArgvFlags(process.argv.slice(2), {
    stringFlags: { "subject-pack": true },
    defaults: { subjectPack: null }
  });
  console.log(JSON.stringify(buildWorkspaceHealthReport({ subjectPack: options.subjectPack }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
