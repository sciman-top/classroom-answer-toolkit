import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listSubjectPacks } from "./subject-pack-registry.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

test("registry lists the tracked subject packs in canonical order", () => {
  const packs = listSubjectPacks();
  const assetIds = packs.map((pack) => pack.assetId);

  // active packs first, primary pack before other active packs, then by asset id.
  assert.deepEqual(assetIds, ["junior-physics-answer", "senior-physics-answer", "math-answer"]);
  assert.equal(packs[0].primary, true);
  assert.equal(packs[1].primary, false);
});

test("registry derives snapshot and eval paths from each pack config", () => {
  for (const pack of listSubjectPacks()) {
    assert.ok(
      pack.snapshotPath.startsWith(path.join(repoRoot, ".snapshot-cache")),
      `${pack.assetId} snapshot path should live in the shared cache: ${pack.snapshotPath}`);
    assert.ok(fs.existsSync(pack.evalDatasetPath), `eval dataset missing for ${pack.assetId}: ${pack.evalDatasetPath}`);
    assert.deepEqual(pack.profiles, ["classroom", "compact"]);
    assert.equal(pack.defaultProfile, "classroom");
    assert.ok(fs.existsSync(pack.manifestPath));
    assert.ok(fs.existsSync(pack.configPath));
  }
});

test("registry snapshot paths match the declared config cache paths", () => {
  const expected = {
    "junior-physics-answer": "resolved-snapshot.json",
    "senior-physics-answer": "resolved-snapshot.senior-physics.json",
    "math-answer": "resolved-snapshot.math.json"
  };
  for (const pack of listSubjectPacks()) {
    assert.equal(
      path.basename(pack.snapshotPath),
      expected[pack.assetId],
      `${pack.assetId} snapshot file name drifted from config.json`);
  }
});

test("registry tolerates a repository without subject packs", () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "registry-empty-"));
  try {
    fs.mkdirSync(path.join(emptyRoot, "prompts"), { recursive: true });
    assert.deepEqual(listSubjectPacks({ repositoryRoot: emptyRoot }), []);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});
