import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { attachDecisionRecord } from "./attach-decision.mjs";
import { manifestWriteLockPath } from "../manifest-write-lock.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const caseRoot = path.join(repoRoot, "eval", "visual-evidence", "cases");

function readFixture(fileName) {
  return JSON.parse(fs.readFileSync(path.join(caseRoot, fileName), "utf8"));
}

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-attach-decision-"));
  const manifestPath = path.join(root, "sample.delivery-manifest.json");
  const decisionPath = path.join(root, "review", "decision.json");
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(createManifest(), null, 2)}\n`, "utf8");
  fs.writeFileSync(decisionPath, `${JSON.stringify(readFixture("unsafe-shortcut-grounding-missing.decision-record.json"), null, 2)}\n`, "utf8");
  return {
    root,
    manifestPath,
    decisionPath,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function createManifest() {
  return {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt: "2026-07-25T00:00:00Z",
    subjectPack: "math-answer",
    snapshotId: "snapshot-test",
    snapshotPath: ".snapshot-cache/resolved-snapshot.math.json",
    snapshot: {
      id: "snapshot-test",
      version: "v0.1",
      profile: "classroom"
    },
    profile: "classroom",
    input: "sample-answer.md",
    output: "sample-answer.pdf",
    review: {
      outputDir: ".pdf-review/sample-answer",
      manifestPath: ".pdf-review/sample-answer/manifest.json",
      scale: "2",
      lifecycle: {
        state: "ready_for_review",
        updatedAt: "2026-07-25T00:00:00Z"
      },
      feedbackRefs: []
    },
    status: {
      toolchainPassed: true,
      deliveryComplete: true,
      reviewArtifactReady: true,
      visualReviewPassed: null,
      trusted: false
    }
  };
}

test("attachDecisionRecord projects fail-closed status and preserves a rollback backup", () => {
  const workspace = createWorkspace();
  try {
    const original = fs.readFileSync(workspace.manifestPath, "utf8");

    const result = attachDecisionRecord({
      manifestPath: workspace.manifestPath,
      decisionPath: workspace.decisionPath
    });

    const manifest = JSON.parse(fs.readFileSync(workspace.manifestPath, "utf8"));
    assert.equal(manifest.review.visualDecisionRef, "review/decision.json");
    assert.equal(manifest.status.visualReviewPassed, null);
    assert.equal(manifest.status.trusted, false);
    assert.equal(fs.readFileSync(result.backupPath, "utf8"), original);
    assert.equal(result.changed, true);
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord rejects a subject-pack mismatch without modifying the manifest", () => {
  const workspace = createWorkspace();
  try {
    const decision = readFixture("unsafe-shortcut-grounding-missing.decision-record.json");
    decision.subjectPack = "junior-physics-answer";
    fs.writeFileSync(workspace.decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
    const original = fs.readFileSync(workspace.manifestPath, "utf8");

    assert.throws(
      () => attachDecisionRecord({
        manifestPath: workspace.manifestPath,
        decisionPath: workspace.decisionPath
      }),
      /subjectPack/
    );
    assert.equal(fs.readFileSync(workspace.manifestPath, "utf8"), original);
    assert.equal(fs.existsSync(`${workspace.manifestPath}.before-visual-decision.json`), false);
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord rejects inconsistent top-level and status projection values", () => {
  const workspace = createWorkspace();
  try {
    const decision = readFixture("unsafe-shortcut-grounding-missing.decision-record.json");
    decision.statusProjection.trusted = true;
    fs.writeFileSync(workspace.decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");

    assert.throws(
      () => attachDecisionRecord({
        manifestPath: workspace.manifestPath,
        decisionPath: workspace.decisionPath
      }),
      /statusProjection\.trusted/
    );
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord rejects positive trust without a delivery-level aggregate", () => {
  const workspace = createWorkspace();
  try {
    const decision = readFixture("unsafe-shortcut-grounding-missing.decision-record.json");
    decision.decision = "accept";
    decision.trusted = true;
    decision.visualReviewPassed = true;
    decision.reviewRequired = false;
    decision.reviewQueue = "none";
    decision.statusProjection = {
      visualReviewPassed: true,
      trusted: true
    };
    fs.writeFileSync(workspace.decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");

    assert.throws(
      () => attachDecisionRecord({
        manifestPath: workspace.manifestPath,
        decisionPath: workspace.decisionPath
      }),
      /delivery-level aggregate/
    );
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord refreshes the rollback backup for a regenerated manifest", () => {
  const workspace = createWorkspace();
  try {
    attachDecisionRecord({
      manifestPath: workspace.manifestPath,
      decisionPath: workspace.decisionPath
    });

    const regeneratedManifest = createManifest();
    regeneratedManifest.snapshot.id = "snapshot-regenerated";
    regeneratedManifest.snapshotId = "snapshot-regenerated";
    regeneratedManifest.generatedAt = "2026-07-25T01:00:00Z";
    const regeneratedText = `${JSON.stringify(regeneratedManifest, null, 2)}\n`;
    fs.writeFileSync(workspace.manifestPath, regeneratedText, "utf8");

    const result = attachDecisionRecord({
      manifestPath: workspace.manifestPath,
      decisionPath: workspace.decisionPath
    });

    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(result.backupPath, "utf8"), regeneratedText);
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord is idempotent for the same decision projection", () => {
  const workspace = createWorkspace();
  try {
    const firstResult = attachDecisionRecord({
      manifestPath: workspace.manifestPath,
      decisionPath: workspace.decisionPath
    });
    const firstManifest = fs.readFileSync(workspace.manifestPath, "utf8");
    const firstBackup = fs.readFileSync(firstResult.backupPath, "utf8");

    const secondResult = attachDecisionRecord({
      manifestPath: workspace.manifestPath,
      decisionPath: workspace.decisionPath
    });

    assert.equal(secondResult.changed, false);
    assert.equal(fs.readFileSync(workspace.manifestPath, "utf8"), firstManifest);
    assert.equal(fs.readFileSync(firstResult.backupPath, "utf8"), firstBackup);
  } finally {
    workspace.dispose();
  }
});

test("attachDecisionRecord uses the shared delivery manifest write lock", () => {
  const workspace = createWorkspace();
  const lockPath = manifestWriteLockPath(workspace.manifestPath);
  try {
    fs.writeFileSync(lockPath, "active writer\n", "utf8");

    assert.throws(
      () => attachDecisionRecord({
        manifestPath: workspace.manifestPath,
        decisionPath: workspace.decisionPath
      }),
      /manifest write lock is unavailable/
    );
    assert.equal(JSON.parse(fs.readFileSync(workspace.manifestPath, "utf8")).review.visualDecisionRef, undefined);
  } finally {
    workspace.dispose();
  }
});
