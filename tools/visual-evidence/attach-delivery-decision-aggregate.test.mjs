import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  attachDeliveryDecisionAggregate,
  verifyDeliveryDecisionAggregateAttachment
} from "./attach-delivery-decision-aggregate.mjs";
import {
  assertManifestPathIsNotSymbolicLink,
  manifestWriteLockPath,
  manifestWriteLockPaths,
  withManifestWriteLock
} from "../manifest-write-lock.mjs";

const fixtureRoot = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "eval",
  "visual-evidence",
  "cases",
  "delivery-aggregate");
const verifierPath = path.join(import.meta.dirname, "verify-delivery-decision-aggregate-attachment.mjs");

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-attach-aggregate-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return {
    root,
    manifestPath: path.join(root, "synthetic.delivery-manifest.json"),
    aggregatePath: path.join(root, "synthetic.delivery-decision-aggregate.json"),
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("attachDeliveryDecisionAggregate verifies preimage and writes a receipt-backed trusted projection", () => {
  const workspace = createWorkspace();
  try {
    const originalManifest = fs.readFileSync(workspace.manifestPath);
    const original = JSON.parse(originalManifest.toString("utf8"));
    const result = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    const manifestBytes = fs.readFileSync(workspace.manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const receipt = readJson(result.receiptPath);

    assert.equal(result.changed, true);
    assert.equal(manifest.status.visualReviewPassed, true);
    assert.equal(manifest.status.trusted, true);
    assert.equal(manifest.review.lifecycle.state, original.review.lifecycle.state);
    assert.equal(manifest.review.deliveryDecisionAggregateAttachment.aggregateRef,
      "synthetic.delivery-decision-aggregate.json");
    assert.equal(manifest.review.deliveryDecisionAggregateAttachment.manifestPreimageSha256,
      sha256(originalManifest));
    assert.equal(receipt.manifestResultSha256, sha256(manifestBytes));
    assert.equal(fs.readFileSync(result.preimageBackupPath).toString("utf8"), originalManifest.toString("utf8"));
    assert.deepEqual(verifyDeliveryDecisionAggregateAttachment({ manifestPath: workspace.manifestPath }), {
      kind: "delivery-decision-aggregate-attachment",
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      preimageBackupPath: result.preimageBackupPath,
      receiptPath: result.receiptPath,
      attachmentId: result.attachmentId,
      manifestPreimageSha256: result.manifestPreimageSha256,
      manifestResultSha256: result.manifestResultSha256,
      visualReviewPassed: true,
      trusted: true
    });
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate is idempotent only after full attachment verification", () => {
  const workspace = createWorkspace();
  try {
    const first = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    const manifestBytes = fs.readFileSync(workspace.manifestPath);
    const receiptBytes = fs.readFileSync(first.receiptPath);
    const second = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath
    });

    assert.equal(second.changed, false);
    assert.equal(second.attachmentId, first.attachmentId);
    assert.deepEqual(fs.readFileSync(workspace.manifestPath), manifestBytes);
    assert.deepEqual(fs.readFileSync(first.receiptPath), receiptBytes);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate rejects a manifest that no longer matches aggregate preimage", () => {
  const workspace = createWorkspace();
  try {
    fs.appendFileSync(workspace.manifestPath, "\n", "utf8");
    const original = fs.readFileSync(workspace.manifestPath);

    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath
      }),
      /manifest preimage|manifestSha256/
    );
    assert.deepEqual(fs.readFileSync(workspace.manifestPath), original);
    assert.equal(fs.existsSync(`${workspace.manifestPath}.before-delivery-decision-aggregate.json`), false);
  } finally {
    workspace.dispose();
  }
});

test("verifyDeliveryDecisionAggregateAttachment rejects a tampered receipt", () => {
  const workspace = createWorkspace();
  try {
    const result = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    const receipt = readJson(result.receiptPath);
    receipt.manifestResultSha256 = "a".repeat(64);
    writeJson(result.receiptPath, receipt);

    assert.throws(
      () => verifyDeliveryDecisionAggregateAttachment({ manifestPath: workspace.manifestPath }),
      /hash chain/
    );
  } finally {
    workspace.dispose();
  }
});

test("verifyDeliveryDecisionAggregateAttachment rejects a tampered preimage backup", () => {
  const workspace = createWorkspace();
  try {
    const result = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    fs.appendFileSync(result.preimageBackupPath, "\n", "utf8");

    assert.throws(
      () => verifyDeliveryDecisionAggregateAttachment({ manifestPath: workspace.manifestPath }),
      /hash chain/
    );
  } finally {
    workspace.dispose();
  }
});

test("aggregate attachment verifier CLI is read-only and reports the verified chain", () => {
  const workspace = createWorkspace();
  try {
    const result = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    const manifestBytes = fs.readFileSync(workspace.manifestPath);
    const receiptBytes = fs.readFileSync(result.receiptPath);
    const cli = spawnSync(process.execPath, [verifierPath, "--manifest", workspace.manifestPath], {
      encoding: "utf8"
    });

    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).trusted, true);
    assert.deepEqual(fs.readFileSync(workspace.manifestPath), manifestBytes);
    assert.deepEqual(fs.readFileSync(result.receiptPath), receiptBytes);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate rejects manifest drift after verification before any write", () => {
  const workspace = createWorkspace();
  try {
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath,
        testHooks: {
          beforeCommit() {
            fs.appendFileSync(workspace.manifestPath, "\n", "utf8");
          }
        }
      }),
      /changed during aggregate source verification/
    );
    assert.equal(fs.existsSync(`${workspace.manifestPath}.before-delivery-decision-aggregate.json`), false);
    assert.equal(fs.existsSync(`${workspace.manifestPath}.delivery-decision-aggregate-attachment-receipt.json`), false);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate leaves the preimage active when interrupted after receipt write", () => {
  const workspace = createWorkspace();
  try {
    const original = fs.readFileSync(workspace.manifestPath);
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath,
        testHooks: {
          afterReceiptWrite() {
            throw new Error("synthetic receipt-stage interruption");
          }
        }
      }),
      /synthetic receipt-stage interruption/
    );
    assert.deepEqual(fs.readFileSync(workspace.manifestPath), original);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate rejects manifest drift after receipt write before manifest replacement", () => {
  const workspace = createWorkspace();
  try {
    const original = fs.readFileSync(workspace.manifestPath);
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath,
        testHooks: {
          beforeManifestWrite() {
            fs.appendFileSync(workspace.manifestPath, "\n", "utf8");
          }
        }
      }),
      /delivery manifest changed during aggregate source verification/
    );
    assert.notDeepEqual(fs.readFileSync(workspace.manifestPath), original);
    assert.equal(readJson(workspace.manifestPath).review.deliveryDecisionAggregateAttachment, undefined);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate rejects source drift after receipt write before manifest replacement", () => {
  const workspace = createWorkspace();
  const coveragePath = path.join(workspace.root, "synthetic.delivery-question-coverage.json");
  try {
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath,
        testHooks: {
          beforeManifestWrite() {
            fs.appendFileSync(coveragePath, "\n", "utf8");
          }
        }
      }),
      /delivery question coverage changed during aggregate source verification/
    );
    assert.equal(readJson(workspace.manifestPath).review.deliveryDecisionAggregateAttachment, undefined);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate restores preimage when post-write verification fails", () => {
  const workspace = createWorkspace();
  try {
    const original = fs.readFileSync(workspace.manifestPath);
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath,
        testHooks: {
          afterManifestWrite() {
            const receiptPath = `${workspace.manifestPath}.delivery-decision-aggregate-attachment-receipt.json`;
            const receipt = readJson(receiptPath);
            receipt.manifestResultSha256 = "c".repeat(64);
            writeJson(receiptPath, receipt);
          }
        }
      }),
      /post-write verification failed/
    );
    assert.deepEqual(fs.readFileSync(workspace.manifestPath), original);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate canonicalizes Windows path case for idempotency", () => {
  const workspace = createWorkspace();
  try {
    attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath,
      aggregatePath: workspace.aggregatePath,
      createdAt: "2026-07-26T00:00:00Z"
    });
    const second = attachDeliveryDecisionAggregate({
      manifestPath: workspace.manifestPath.toUpperCase(),
      aggregatePath: workspace.aggregatePath.toUpperCase()
    });
    assert.equal(second.changed, false);
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate rejects a concurrent writer lock", () => {
  const workspace = createWorkspace();
  const lockPath = manifestWriteLockPath(workspace.manifestPath);
  try {
    fs.writeFileSync(lockPath, "other writer\n", "utf8");
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath
      }),
      /lock is unavailable/
    );
  } finally {
    workspace.dispose();
  }
});

test("attachDeliveryDecisionAggregate preserves an expired lock for audited manual recovery", () => {
  const workspace = createWorkspace();
  const lockPath = manifestWriteLockPath(workspace.manifestPath);
  try {
    writeJson(lockPath, {
      schemaVersion: "1.0",
      kind: "delivery-manifest-write-lock",
      ownerPid: 2147483647,
      hostname: os.hostname(),
      acquiredAt: "2026-07-25T00:00:00.000Z",
      token: "expired-owner-token"
    });

    const lockBytes = fs.readFileSync(lockPath);
    assert.throws(
      () => attachDeliveryDecisionAggregate({
        manifestPath: workspace.manifestPath,
        aggregatePath: workspace.aggregatePath
      }),
      /manifest write lock is unavailable/
    );

    assert.deepEqual(fs.readFileSync(lockPath), lockBytes);
    assert.equal(readJson(workspace.manifestPath).review.deliveryDecisionAggregateAttachment, undefined);
  } finally {
    workspace.dispose();
  }
});

test("delivery manifest write lock serializes hardlink aliases by physical identity", () => {
  const workspace = createWorkspace();
  const aliasPath = path.join(workspace.root, "synthetic.delivery-manifest.alias.json");
  try {
    fs.linkSync(workspace.manifestPath, aliasPath);
    const primaryLocks = manifestWriteLockPaths(workspace.manifestPath);
    const aliasLocks = manifestWriteLockPaths(aliasPath);
    assert.equal(primaryLocks.some((lockPath) => aliasLocks.includes(lockPath)), true);

    withManifestWriteLock(workspace.manifestPath, () => {
      assert.throws(
        () => attachDeliveryDecisionAggregate({
          manifestPath: aliasPath,
          aggregatePath: workspace.aggregatePath
        }),
        /manifest write lock is unavailable/
      );
    });
  } finally {
    workspace.dispose();
  }
});

test("delivery manifest write lock rejects a dangling manifest symlink before following its target", () => {
  const linkPath = path.join(os.tmpdir(), "not-followed.delivery-manifest.json");
  assert.throws(
    () => assertManifestPathIsNotSymbolicLink(linkPath, () => ({
      isSymbolicLink: () => true
    })),
    /must not be a symbolic link/
  );
});

test("delivery manifest write lock cleans partial acquisition without touching the conflicting lock", () => {
  const workspace = createWorkspace();
  const aliasPath = path.join(workspace.root, "synthetic.delivery-manifest.partial-alias.json");
  let physicalLock;
  try {
    fs.linkSync(workspace.manifestPath, aliasPath);
    const aliasLocks = manifestWriteLockPaths(aliasPath);
    assert.equal(aliasLocks.length, 2);
    const [aliasAdjacentLock, sharedPhysicalLock] = aliasLocks;
    physicalLock = sharedPhysicalLock;
    const conflictBytes = Buffer.from("conflicting physical owner\n", "utf8");
    fs.mkdirSync(path.dirname(physicalLock), { recursive: true });
    fs.writeFileSync(physicalLock, conflictBytes, { flag: "wx" });

    assert.throws(
      () => withManifestWriteLock(aliasPath, () => undefined),
      /manifest write lock is unavailable/
    );
    assert.equal(fs.existsSync(aliasAdjacentLock), false);
    assert.deepEqual(fs.readFileSync(physicalLock), conflictBytes);
  } finally {
    if (physicalLock) {
      fs.rmSync(physicalLock, { force: true });
    }
    workspace.dispose();
  }
});

test("delivery manifest write lock releases both owned locks when the action fails", () => {
  const workspace = createWorkspace();
  try {
    const lockPaths = manifestWriteLockPaths(workspace.manifestPath);
    assert.throws(
      () => withManifestWriteLock(workspace.manifestPath, () => {
        throw new Error("synthetic action failure");
      }),
      /synthetic action failure/
    );
    assert.equal(lockPaths.every((lockPath) => !fs.existsSync(lockPath)), true);
  } finally {
    workspace.dispose();
  }
});

test("delivery manifest write lock does not remove a lock whose token was replaced", () => {
  const workspace = createWorkspace();
  const lockPaths = manifestWriteLockPaths(workspace.manifestPath);
  const replacement = {
    kind: "delivery-manifest-write-lock",
    token: "replacement-owner-token"
  };
  try {
    withManifestWriteLock(workspace.manifestPath, () => {
      writeJson(lockPaths[0], replacement);
    });

    assert.deepEqual(readJson(lockPaths[0]), replacement);
    assert.equal(fs.existsSync(lockPaths[1]), false);
  } finally {
    fs.rmSync(lockPaths[0], { force: true });
    workspace.dispose();
  }
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
