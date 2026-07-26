import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  gateDefinitions,
  validateReadinessControlReceipt
} from "./readiness-control-receipt.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("validates a complete hash-bound offline control receipt", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    assert.equal(
      validateReadinessControlReceipt(receipt, receiptPath, {
        requireCurrentSource: false
      }),
      receipt);
  });
});

test("rejects missing, reordered, or failed gates", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    for (const gateSequence of [
      receipt.gateSequence.slice(0, -1),
      [receipt.gateSequence[1], receipt.gateSequence[0], ...receipt.gateSequence.slice(2)],
      receipt.gateSequence.map((gate, index) =>
        index === 0 ? { ...gate, exitCode: 1 } : gate)
    ]) {
      assert.throws(
        () => validateReadinessControlReceipt(
          { ...receipt, gateSequence },
          receiptPath,
          { requireCurrentSource: false }),
        /stable clean passed run|gate sequence or result|verdict is inconsistent|failed gate must be the final recorded gate/);
    }
  });
});

test("rejects log drift and path escape", () => {
  usingReceipt(({ directory, receipt, receiptPath }) => {
    fs.appendFileSync(path.join(directory, receipt.gateSequence[0].logRef), "drift");
    assert.throws(
      () => validateReadinessControlReceipt(receipt, receiptPath, {
        requireCurrentSource: false
      }),
      /does not match log bytes/);
  });

  usingReceipt(({ receipt, receiptPath }) => {
    const escaped = {
      ...receipt,
      gateSequence: receipt.gateSequence.map((gate, index) =>
        index === 0 ? { ...gate, logRef: "../outside.log" } : gate)
    };
    assert.throws(
      () => validateReadinessControlReceipt(escaped, receiptPath, {
        requireCurrentSource: false
      }),
      /file not found|escapes/);
  });
});

test("rejects a hardlinked receipt log", (context) => {
  usingReceipt(({ directory, receipt, receiptPath }) => {
    const logPath = path.join(directory, receipt.gateSequence[0].logRef);
    const hardlinkPath = path.join(directory, "hardlink.log");
    try {
      fs.linkSync(logPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => validateReadinessControlReceipt(receipt, receiptPath, {
        requireCurrentSource: false
      }),
      /file not found/);
  });
});

test("rejects positive verdict without clean stable source or disabled egress", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    for (const mutation of [
      { sourceTreeCleanBefore: false },
      { sourceTreeCleanAfter: false },
      { verdict: "failed" },
      {
        cloudEgress: {
          ...receipt.cloudEgress,
          environmentForcedDisabled: false
        }
      },
      {
        cloudEgress: {
          ...receipt.cloudEgress,
          liveProbesRun: true
        }
      }
    ]) {
      assert.throws(
        () => validateReadinessControlReceipt(
          { ...receipt, ...mutation },
          receiptPath,
          { requireCurrentSource: false }),
        /runner must start from a clean source tree|verdict is inconsistent|stable clean passed run|cloud-egress boundary/);
    }
  });
});

test("current-source verification rejects a receipt for another revision", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    assert.throws(
      () => validateReadinessControlReceipt(receipt, receiptPath),
      /current clean source revision/);
  });
});

test("structural verification preserves a failed prefix receipt", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    const failed = {
      ...receipt,
      gateSequence: [{
        ...receipt.gateSequence[0],
        exitCode: 1
      }],
      verdict: "failed"
    };
    assert.equal(
      validateReadinessControlReceipt(failed, receiptPath, {
        requireCurrentSource: false,
        requirePassed: false
      }),
      failed);
  });
});

test("structural verification rejects impossible failed sequences", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    const impossible = [
      {
        ...receipt,
        gateSequence: [
          { ...receipt.gateSequence[0], exitCode: 1 },
          receipt.gateSequence[1]
        ],
        verdict: "failed"
      },
      {
        ...receipt,
        gateSequence: receipt.gateSequence.slice(0, 2),
        verdict: "failed"
      },
      {
        ...receipt,
        verdict: "failed"
      }
    ];
    for (const candidate of impossible) {
      assert.throws(
        () => validateReadinessControlReceipt(candidate, receiptPath, {
          requireCurrentSource: false,
          requirePassed: false
        }),
        /final recorded gate|no gate or source-drift cause|verdict is inconsistent/);
    }
  });
});

test("structural verification accepts complete gates followed by source drift", () => {
  usingReceipt(({ receipt, receiptPath }) => {
    const drifted = {
      ...receipt,
      sourceTreeCleanAfter: false,
      verdict: "failed"
    };
    assert.equal(
      validateReadinessControlReceipt(drifted, receiptPath, {
        requireCurrentSource: false,
        requirePassed: false
      }),
      drifted);
  });
});

test("runner rejects repository-owned output directories before execution", () => {
  const outputPath = path.join(repoRoot, `.receipt-output-test-${process.pid}`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "readiness-control-receipt.mjs"),
      "--out-dir",
      outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the repository/);
  assert.equal(fs.existsSync(outputPath), false);
});

test("receipt log paths are unique fixed names", () => {
  const names = gateDefinitions.map((gate, index) =>
    `${String(index + 1).padStart(2, "0")}-${gate.gateId}.log`);
  assert.equal(new Set(names).size, gateDefinitions.length);
  assert.ok(names.every((name) => /^[0-9]{2}-[a-z_]+\.log$/.test(name)));
});

function usingReceipt(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-control-receipt-"));
  try {
    const gateSequence = gateDefinitions.map((gate, index) => {
      const logRef = `${String(index + 1).padStart(2, "0")}-${gate.gateId}.log`;
      const logBytes = Buffer.from(`${gate.gateId} synthetic contract log\n`);
      fs.writeFileSync(path.join(directory, logRef), logBytes);
      return {
        ...gate,
        exitCode: 0,
        logRef,
        logSha256: sha256(logBytes)
      };
    });
    const receipt = {
      schemaVersion: "1.0",
      kind: "readiness-control-receipt",
      receiptId: "readiness-control-0123456789abcdef",
      sourceRevision: "0".repeat(40),
      sourceTreeCleanBefore: true,
      sourceTreeCleanAfter: true,
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:01:00.000Z",
      gateSequence,
      cloudEgress: {
        environmentForcedDisabled: true,
        liveProbesRun: false,
        scope: "controlled_gate_processes_only"
      },
      verdict: "passed"
    };
    const receiptPath = path.join(directory, "readiness-control-receipt.json");
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    action({ directory, receipt, receiptPath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
