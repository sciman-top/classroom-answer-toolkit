import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildMergedAssets, mergeProfiles, mergeRulePacks } from "./merge-rules.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

test("mergeRulePacks sorts by priority desc then id and rejects duplicate ids", () => {
  const packs = [
    { rules: [{ id: "b.low", priority: 1 }, { id: "a.high", priority: 10 }] },
    { rules: [{ id: "c.mid", priority: 5 }] }
  ];
  assert.deepEqual(
    mergeRulePacks(packs).map((rule) => rule.id),
    ["a.high", "c.mid", "b.low"]);

  assert.throws(
    () => mergeRulePacks([{ rules: [{ id: "x" }] }, { rules: [{ id: "x" }] }]),
    /Duplicate rule id: x/);
});

test("mergeProfiles rejects same-directory duplicates but allows cross-layer overrides", () => {
  const platformFile = {
    relativePath: "prompts/platform-core/profiles/classroom.json",
    baseName: "classroom",
    name: "classroom",
    profile: { name: "classroom" }
  };
  const subjectFile = {
    relativePath: "prompts/x-answer/profiles/classroom.json",
    baseName: "classroom",
    name: "classroom",
    profile: { name: "classroom", subject: true }
  };
  const graph = mergeProfiles([platformFile, subjectFile]);
  assert.equal(graph.profilesByPath.size, 2);
  assert.equal(graph.aliases.get("classroom"), subjectFile.relativePath);

  assert.throws(
    () => mergeProfiles([platformFile, {
      relativePath: "prompts/platform-core/profiles/classroom-copy.json",
      baseName: "classroom-copy",
      name: "classroom",
      profile: { name: "classroom" }
    }]),
    /Duplicate profile name "classroom" in prompts\/platform-core\/profiles/);
});

function writeFixture(relativePath, value) {
  const filePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

let fixtureRoot;

function buildFixtureAssets({ subjectProfiles } = {}) {
  const rel = (relativePath) => path.relative(repoRoot, path.join(fixtureRoot, relativePath)).replace(/\\/g, "/");
  return buildMergedAssets({
    platformManifest: rel("platform/manifest.json"),
    platformRulesDir: rel("platform/rules"),
    platformProfilesDir: rel("platform/profiles"),
    subjectManifest: rel("subject/manifest.json"),
    subjectConfig: rel("subject/config.json"),
    subjectRulesDir: rel("subject/rules"),
    subjectProfilesDir: rel(subjectProfiles ?? "subject/profiles")
  });
}

test.beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "merge-rules-"));
});

test.afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeMinimalWorkspace() {
  writeFixture("platform/manifest.json", { kind: "platform-core", version: "v1.0" });
  writeFixture("platform/rules/platform.json", { rules: [{ id: "delivery.core", priority: 100 }] });
  writeFixture("platform/profiles/base.json", { name: "base", layout: { marginMm: 10 } });
  writeFixture("subject/manifest.json", { kind: "subject-pack", assetId: "x-answer", version: "v0.1" });
  writeFixture("subject/config.json", { profiles: { default: "classroom" } });
  writeFixture("subject/rules/subject.json", { rules: [{ id: "x-answer.topic.rule", priority: 50 }] });
}

test("buildMergedAssets resolves profile inheritance chains", () => {
  writeMinimalWorkspace();
  writeFixture("subject/profiles/classroom.json", {
    name: "classroom",
    inherits: ["base"],
    layout: { marginMm: 20 }
  });

  const assets = buildFixtureAssets();
  const classroom = assets.profiles.classroom;
  assert.equal(classroom.layout.marginMm, 20);
  assert.equal(assets.rules.map((rule) => rule.id).join(","), "delivery.core,x-answer.topic.rule");
});

test("buildMergedAssets rejects circular profile inheritance", () => {
  writeMinimalWorkspace();
  writeFixture("subject/profiles/a.json", { name: "a", inherits: ["b"] });
  writeFixture("subject/profiles/b.json", { name: "b", inherits: ["a"] });
  writeFixture("subject/config.json", { profiles: { default: "a" } });

  assert.throws(() => buildFixtureAssets(), /Circular profile inheritance detected/);
});
