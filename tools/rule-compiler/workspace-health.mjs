import fs from "node:fs";
import path from "node:path";

import { listSubjectPacks, primarySubjectPackAssetId } from "./subject-pack-registry.mjs";
import { isDirectInvocation, parseArgvFlags, repositoryRoot as repoRoot } from "../shared.mjs";

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

// The teacher's only setup step is filling their own key into the seeded .env,
// so health reports key PRESENCE (never its value). A missing file is
// structural (the installer seeds it, dev setup generates it); an unfilled key
// is pending setup, not breakage — it surfaces through the summary hint and
// must not turn the workspace unhealthy (the packaged smoke ships a keyless
// seed).
const TEACHER_API_KEY_FIELD = "CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY";

function readEnvSetupStatus(repositoryRoot) {
  let content;
  try {
    content = fs.readFileSync(path.join(repositoryRoot, ".env"), "utf8");
  } catch {
    return { fileExists: false, apiKeyConfigured: false };
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0 || line.slice(0, separator).trim() !== TEACHER_API_KEY_FIELD) {
      continue;
    }
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    return { fileExists: true, apiKeyConfigured: value.length > 0 };
  }
  return { fileExists: true, apiKeyConfigured: false };
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
  const envSetup = readEnvSetupStatus(repositoryRoot);
  if (!envSetup.fileExists) {
    issues.push("缺少 .env 配置文件（安装包自带模板，开发工作区由 setup 生成）。");
  }
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
      apiKeyConfigured: false,
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
  const setupHint = envSetup.apiKeyConfigured
    ? ""
    : `尚未配置 AI 密钥：用记事本打开 ${path.join(repositoryRoot, ".env")}，填入自备 API key（${TEACHER_API_KEY_FIELD}、BASE_URL 等），并把 CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED 改为 true，保存后重新体检。`;
  const summary = uniqueIssues.length === 0 && !setupHint
    ? "规则快照、评测结果与最新规范已对齐。"
    : [...uniqueIssues, setupHint].filter(Boolean).join("；");

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
    apiKeyConfigured: envSetup.apiKeyConfigured,
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

if (isDirectInvocation(import.meta.url)) {
  main();
}
