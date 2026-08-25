import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWorkspaceHealthReport } from "./workspace-health.mjs";

function compiledHumanSpecPath(subjectPack, version) {
  const titles = {
    "junior-physics-answer": "试卷参考答案交付规范-初中物理-完整版",
    "senior-physics-answer": "试卷参考答案交付规范-高中物理-完整版",
    "math-answer": "试卷参考答案交付规范-初中数学-完整版"
  };
  return `../specs/compiled/${titles[subjectPack] ?? `${subjectPack}-full`}-${version}.md`;
}

function snapshotIdFor(subjectPack, version) {
  return `snapshot-${subjectPack}-${version}-classroom`;
}

class TemporaryWorkspace {
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-health-"));
  }

  writeManifest(subjectPack, version, humanSpec = null) {
    const manifest = {
      kind: "subject-pack",
      assetId: subjectPack,
      version,
      status: subjectPack === "math-answer" ? "experimental" : "active",
      sourceOfTruth: {
        humanSpec: humanSpec ?? compiledHumanSpecPath(subjectPack, version),
        runtimeConfig: "./config.json"
      },
      evaluation: { resultsDir: `../../eval/${subjectPack}/results` }
    };
    this.writeRaw(path.join("prompts", subjectPack, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  writeRawManifest(subjectPack, content) {
    this.writeRaw(path.join("prompts", subjectPack, "manifest.json"), content);
  }

  writeConfig(subjectPack, snapshotPath) {
    this.writeRaw(
      path.join("prompts", subjectPack, "config.json"),
      `${JSON.stringify({ snapshot: { cachePath: snapshotPath } }, null, 2)}\n`);
  }

  writeSnapshot(subjectPack, version, profile = "classroom") {
    this.writeRaw(this.snapshotFile(subjectPack), `${JSON.stringify({
      snapshotId: snapshotIdFor(subjectPack, version),
      subjectPack: { version },
      activeProfile: { name: profile }
    }, null, 2)}\n`);
  }

  writeRawSnapshot(subjectPack, content) {
    this.writeRaw(this.snapshotFile(subjectPack), content);
  }

  writeEval(subjectPack, assetVersion, ok, caseCount, snapshotId = null) {
    const id = snapshotId ?? snapshotIdFor(subjectPack, assetVersion);
    this.writeRaw(path.join("eval", subjectPack, "results", "latest.json"), `${JSON.stringify({
      assetVersion,
      ok,
      cases: Array.from({ length: caseCount }, () => ({
        profiles: { classroom: { actual: { snapshot: { snapshotId: id } } } }
      }))
    }, null, 2)}\n`);
  }

  writeRawEval(subjectPack, content) {
    this.writeRaw(path.join("eval", subjectPack, "results", "latest.json"), content);
  }

  writeRaw(relativePath, content) {
    const filePath = path.join(this.root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }

  snapshotFile(subjectPack) {
    return path.join(".snapshot-cache", subjectPack === "math-answer"
      ? "resolved-snapshot.math.json"
      : "resolved-snapshot.json");
  }

  health(options = {}) {
    return buildWorkspaceHealthReport({ repositoryRoot: this.root, ...options });
  }

  dispose() {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function alignedWorkspace() {
  const workspace = new TemporaryWorkspace();
  workspace.writeManifest("junior-physics-answer", "v11.0");
  workspace.writeConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
  workspace.writeSnapshot("junior-physics-answer", "v11.0");
  workspace.writeEval("junior-physics-answer", "v11.0", true, 4);
  return workspace;
}

test("healthy report when the primary pack is aligned", () => {
  const workspace = alignedWorkspace();
  try {
    const report = workspace.health();
    assert.deepEqual(report.issues, []);
    assert.equal(report.primarySubjectPack, "junior-physics-answer");
    assert.equal(report.assetVersion, "v11.0");
    assert.equal(report.latestProductionSpecVersion, "v11.0");
    assert.equal(report.snapshotExists, true);
    assert.equal(report.evalOk, true);
    assert.equal(report.evalCaseCount, 4);
  } finally {
    workspace.dispose();
  }
});

test("primary pack wins over an experimental pack", () => {
  const workspace = alignedWorkspace();
  try {
    workspace.writeManifest("math-answer", "v0.1");
    workspace.writeConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
    workspace.writeSnapshot("math-answer", "v0.1");
    workspace.writeEval("math-answer", "v0.1", true, 1);

    const report = workspace.health();
    assert.equal(report.primarySubjectPack, "junior-physics-answer");
    assert.equal(report.snapshotVersion, "v11.0");
    assert.equal(report.evalCaseCount, 4);
    assert.deepEqual(report.subjectPacks, ["junior-physics-answer", "math-answer"]);
  } finally {
    workspace.dispose();
  }
});

test("requested subject pack overrides the primary pack", () => {
  const workspace = alignedWorkspace();
  try {
    workspace.writeManifest("math-answer", "v0.1");
    workspace.writeConfig("math-answer", "../../.snapshot-cache/resolved-snapshot.math.json");
    workspace.writeSnapshot("math-answer", "v0.1");
    workspace.writeEval("math-answer", "v0.1", true, 2);

    const report = workspace.health({ subjectPack: "math-answer" });
    assert.equal(report.primarySubjectPack, "math-answer");
    assert.equal(report.assetVersion, "v0.1");
    assert.equal(report.evalCaseCount, 2);
  } finally {
    workspace.dispose();
  }
});

test("newer human spec than asset version is an issue", () => {
  const workspace = alignedWorkspace();
  try {
    workspace.writeManifest(
      "junior-physics-answer",
      "v11.0",
      "../specs/compiled/试卷参考答案交付规范-初中物理-完整版-v11.1.md");
    const report = workspace.health();
    assert.ok(report.issues.some((issue) => issue.includes("最新规范 v11.1")));
  } finally {
    workspace.dispose();
  }
});

test("eval asset version drift is an issue", () => {
  const workspace = alignedWorkspace();
  try {
    workspace.writeEval("junior-physics-answer", "v10.9", true, 4);
    const report = workspace.health();
    assert.ok(report.issues.some((issue) => issue.includes("评测结果版本 v10.9")));
  } finally {
    workspace.dispose();
  }
});

test("eval bound to a stale snapshot is an issue", () => {
  const workspace = alignedWorkspace();
  try {
    workspace.writeEval("junior-physics-answer", "v11.0", true, 4, "snapshot-stale");
    const report = workspace.health();
    assert.ok(report.issues.some((issue) => issue.includes("snapshot-stale")));
  } finally {
    workspace.dispose();
  }
});

test("invalid manifest degrades to a diagnostic report instead of throwing", () => {
  const workspace = new TemporaryWorkspace();
  try {
    workspace.writeRawManifest("junior-physics-answer", "{ invalid json");
    const report = workspace.health();
    assert.equal(report.issues.length > 0, true);
    assert.ok(report.issues.some((issue) => issue.includes("无法读取 subject pack 注册表")));
    assert.ok(report.issues.some((issue) => issue.includes("manifest.json")));
  } finally {
    workspace.dispose();
  }
});

test("incomplete snapshot and eval are not treated as healthy", () => {
  const workspace = new TemporaryWorkspace();
  try {
    workspace.writeManifest("junior-physics-answer", "v11.0");
    workspace.writeConfig("junior-physics-answer", "../../.snapshot-cache/resolved-snapshot.json");
    workspace.writeRawSnapshot("junior-physics-answer", "{}");
    workspace.writeRawEval("junior-physics-answer", "{\"ok\":true,\"cases\":[]}");
    const report = workspace.health();
    assert.ok(report.issues.some((issue) => issue.includes("snapshot 缺少")));
    assert.ok(report.issues.some((issue) => issue.includes("assetVersion")));
  } finally {
    workspace.dispose();
  }
});

test("unknown requested subject pack is reported", () => {
  const workspace = alignedWorkspace();
  try {
    const report = workspace.health({ subjectPack: "chemistry-answer" });
    assert.ok(report.issues.some((issue) => issue.includes("未发现 subject pack: chemistry-answer")));
  } finally {
    workspace.dispose();
  }
});
