import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { compileFeedbackParseResult } from "./feedback-parse.mjs";
import {
  compileOptimizationReadinessReport,
  validateOptimizationReadinessInput,
  validateOptimizationReadinessReport
} from "./optimization-readiness.mjs";
import { gateDefinitions } from "./readiness-control-receipt.mjs";
import { compileSampleRun } from "./sample-run.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const candidatePath = path.join(
  repoRoot,
  "样例交付",
  "structured",
  "math-answer",
  "synthetic-linear-equation",
  "candidate.negative-candidate.json");
const indexPath = path.join(repoRoot, "样例交付", "index.json");

test("readiness report exposes all buckets and fails closed on current fixture", () => {
  usingFixture(({ manifestPath }) => {
    const report = compileOptimizationReadinessReport({ manifestPath });

    assert.equal(report.eligible, false);
    assert.deepEqual(report.caseBindings, [{
      caseId: "synthetic-linear-equation-perturbed",
      sampleId: "synthetic-linear-equation",
      candidateSourceType: "perturbed_negative",
      runSha256: report.caseBindings[0].runSha256,
      feedbackSha256: report.caseBindings[0].feedbackSha256,
      candidateDescriptorSha256: report.caseBindings[0].candidateDescriptorSha256,
      expectedError: true,
      detected: true
    }]);
    assert.match(report.caseBindings[0].runSha256, /^[a-f0-9]{64}$/);
    assert.match(report.caseBindings[0].feedbackSha256, /^[a-f0-9]{64}$/);
    assert.match(report.caseBindings[0].candidateDescriptorSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      report.buckets.map((bucket) => bucket.candidateSourceType),
      ["perturbed_negative", "historical_candidate", "generated"]);
    assert.deepEqual(report.buckets[0], {
      candidateSourceType: "perturbed_negative",
      n: 1,
      expectedErrorCount: 1,
      detectedErrorCount: 1,
      recallStatus: "available",
      recall: 1
    });
    assert.deepEqual(report.buckets[1], {
      candidateSourceType: "historical_candidate",
      n: 0,
      expectedErrorCount: 0,
      detectedErrorCount: 0,
      recallStatus: "unavailable"
    });
    assert.deepEqual(report.reasonCodes, [
      "non_perturbed_bucket_sample_count_insufficient",
      "toolchain_not_verified",
      "restricted_egress_not_verified"
    ]);
    assert.deepEqual(report.optimizationCandidateRefs, []);
  });
});

test("missing feedback remains in the denominator and lowers recall", () => {
  usingFixture(({ directory, manifestPath, manifest }) => {
    writeJson(manifestPath, {
      ...manifest,
      cases: [{
        caseId: manifest.cases[0].caseId,
        runRef: manifest.cases[0].runRef,
        runSha256: manifest.cases[0].runSha256
      }]
    });

    const report = compileOptimizationReadinessReport({ manifestPath });
    assert.equal(report.buckets[0].expectedErrorCount, 1);
    assert.equal(report.buckets[0].detectedErrorCount, 0);
    assert.equal(report.buckets[0].recall, 0);
    assert.equal(report.caseBindings[0].detected, false);
    assert.equal("feedbackSha256" in report.caseBindings[0], false);
    assert.ok(report.reasonCodes.includes("perturbed_negative_recall_below_threshold"));
    assert.equal(fs.existsSync(path.join(directory, "optimization-candidate.json")), false);
  });
});

test("readiness input rejects duplicate cases, path escape, and partial feedback binding", () => {
  usingFixture(({ directory, manifestPath, manifest }) => {
    assert.throws(
      () => validateOptimizationReadinessInput({
        ...manifest,
        cases: [manifest.cases[0], manifest.cases[0]]
      }, manifestPath),
      /caseId values must be unique/);
    const escapedPath = path.join(
      path.dirname(directory),
      `${path.basename(directory)}-escaped.json`);
    try {
      fs.copyFileSync(path.join(directory, manifest.cases[0].runRef), escapedPath);
      assert.throws(
        () => validateOptimizationReadinessInput({
          ...manifest,
          cases: [{
            ...manifest.cases[0],
            runRef: `../${path.basename(escapedPath)}`
          }]
        }, manifestPath),
        /escapes/);
    } finally {
      fs.rmSync(escapedPath, { force: true });
    }
    const { feedbackSha256, ...partialFeedbackBinding } = manifest.cases[0];
    assert.equal(typeof feedbackSha256, "string");
    assert.throws(
      () => validateOptimizationReadinessInput({
        ...manifest,
        cases: [partialFeedbackBinding]
      }, manifestPath),
      /provided together/);
  });
});

test("case inventory prevents duplicate evaluation units and input omission", () => {
  usingFixture(({ inventoryPath, manifestPath, inventory, manifest }) => {
    const duplicate = {
      ...inventory.cases[0],
      caseId: "synthetic-linear-equation-duplicate"
    };
    writeJson(inventoryPath, {
      ...inventory,
      cases: [inventory.cases[0], duplicate]
    });
    manifest.caseInventorySha256 = sha256File(inventoryPath);
    manifest.cases.push({ caseId: duplicate.caseId });
    writeJson(manifestPath, manifest);
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /must not repeat a sample and candidate descriptor/);
  });

  usingFixture(({ manifestPath, manifest }) => {
    writeJson(manifestPath, { ...manifest, cases: [] });
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /must exactly cover/);
  });

  usingFixture(({ directory, inventoryPath, manifestPath, manifest }) => {
    fs.copyFileSync(inventoryPath, path.join(directory, "alternate-inventory.json"));
    writeJson(manifestPath, {
      ...manifest,
      caseInventoryRef: "alternate-inventory.json"
    });
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /schema validation|canonical sibling/);
  });
});

test("inventory exposes missing runs and unresolved leakage without an admitted run", () => {
  usingFixture(({ inventoryPath, manifestPath, inventory, manifest }) => {
    writeJson(inventoryPath, {
      ...inventory,
      cases: [{
        ...inventory.cases[0],
        truthExtractionStatus: "low_confidence",
        inputAnswerLeakage: "suspected_unresolved"
      }]
    });
    writeJson(manifestPath, {
      ...manifest,
      caseInventorySha256: sha256File(inventoryPath),
      cases: [{ caseId: manifest.cases[0].caseId }]
    });

    const report = compileOptimizationReadinessReport({ manifestPath });
    assert.equal(report.unresolvedLeakageCount, 1);
    assert.equal(report.buckets[0].n, 1);
    assert.equal(report.buckets[0].detectedErrorCount, 0);
    assert.ok(report.reasonCodes.includes("unresolved_leakage_present"));
    assert.ok(report.reasonCodes.includes("truth_extraction_not_ready_present"));
    assert.ok(report.reasonCodes.includes("scoring_run_missing_present"));
  });
});

test("positive toolchain or egress status is rejected without verifiable receipts", () => {
  usingFixture(({ manifestPath, manifest }) => {
    for (const mutation of [
      { toolchainStatus: "passed" },
      { restrictedEgressStatus: "no_violation_observed" }
    ]) {
      writeJson(manifestPath, { ...manifest, ...mutation });
      assert.throws(
        () => compileOptimizationReadinessReport({ manifestPath }),
        /schema validation|verifiable receipt/);
    }
  });
});

test("hash-bound local receipt remains unattested and cannot authorize controls", () => {
  usingFixture(({ directory, manifestPath, manifest }) => {
    attachSyntheticControlReceipt(directory, manifest);
    writeJson(manifestPath, manifest);
    const report = compileOptimizationReadinessReport({
      manifestPath,
      requireCurrentControlSource: false
    });
    assert.deepEqual(report.controls, {
      toolchainStatus: "not_verified",
      restrictedEgressStatus: "not_verified",
      receiptStatus: "unattested_local_record",
      receiptSha256: manifest.controlReceiptSha256,
      sourceRevision: "0".repeat(40)
    });
    assert.deepEqual(report.reasonCodes, [
      "non_perturbed_bucket_sample_count_insufficient",
      "toolchain_not_verified",
      "restricted_egress_not_verified",
      "control_receipt_unattested"
    ]);
    assert.equal(report.eligible, false);
    assert.deepEqual(report.optimizationCandidateRefs, []);
  });
});

test("control receipt binding rejects partial refs and log drift", () => {
  usingFixture(({ directory, manifestPath, manifest }) => {
    manifest.controlReceiptRef = "readiness-control-receipt.json";
    writeJson(manifestPath, manifest);
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /provided together|schema validation/);
  });

  usingFixture(({ directory, manifestPath, manifest }) => {
    const receipt = attachSyntheticControlReceipt(directory, manifest);
    writeJson(manifestPath, manifest);
    fs.appendFileSync(path.join(directory, receipt.gateSequence[0].logRef), "drift");
    assert.throws(
      () => compileOptimizationReadinessReport({
        manifestPath,
        requireCurrentControlSource: false
      }),
      /does not match log bytes/);
  });
});

test("compiler rejects run, feedback, and current-authority drift", () => {
  usingFixture(({ manifestPath, manifest }) => {
    writeJson(manifestPath, {
      ...manifest,
      cases: [{
        ...manifest.cases[0],
        runSha256: "0".repeat(64)
      }]
    });
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /runSha256 does not match/);
  });

  usingFixture(({ manifestPath, manifest }) => {
    writeJson(manifestPath, {
      ...manifest,
      cases: [{
        ...manifest.cases[0],
        feedbackSha256: "0".repeat(64)
      }]
    });
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /feedbackSha256 does not match/);
  });

  usingFixture(({ directory, manifestPath, manifest, run }) => {
    const runPath = path.join(directory, manifest.cases[0].runRef);
    writeJson(runPath, { ...run, samplePackageSha256: "0".repeat(64) });
    manifest.cases[0].runSha256 = sha256File(runPath);
    writeJson(manifestPath, manifest);
    assert.throws(
      () => compileOptimizationReadinessReport({ manifestPath }),
      /current canonical authority/);
  });
});

test("report validator rejects computed-field and optimization-ref drift", () => {
  usingFixture(({ manifestPath }) => {
    const report = compileOptimizationReadinessReport({ manifestPath });
    assert.throws(
      () => validateOptimizationReadinessReport({
        ...report,
        eligible: true,
        reasonCodes: []
      }, manifestPath),
      /does not match/);
    assert.throws(
      () => validateOptimizationReadinessReport({
        ...report,
        optimizationCandidateRefs: ["optimization-candidate.json"]
      }, manifestPath),
      /does not match|must remain empty/);
  });
});

test("CLI writes a validated report without temporary residue", () => {
  usingFixture(({ directory, manifestPath }) => {
    const outputPath = path.join(directory, "readiness-report.json");
    const result = runCli(manifestPath, outputPath);
    assert.equal(result.status, 0, result.stderr);
    validateOptimizationReadinessReport(readJson(outputPath), manifestPath);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []);
  });
});

test("CLI rejects direct, hardlink, and canonical-authority aliases", (context) => {
  usingFixture(({ directory, manifestPath }) => {
    const originalManifest = fs.readFileSync(manifestPath);
    const directResult = runCli(manifestPath, manifestPath);
    assert.notEqual(directResult.status, 0);
    assert.match(directResult.stderr, /must not alias/);
    assert.deepEqual(fs.readFileSync(manifestPath), originalManifest);

    const hardlinkPath = path.join(directory, "hardlink-output.json");
    try {
      fs.linkSync(manifestPath, hardlinkPath);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "EXDEV"].includes(error?.code)) {
        context.skip(`hardlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const hardlinkResult = runCli(manifestPath, hardlinkPath);
    assert.notEqual(hardlinkResult.status, 0);
    assert.match(hardlinkResult.stderr, /must not alias/);
  });

  usingFixture(({ manifestPath }) => {
    const originalIndex = fs.readFileSync(indexPath);
    const canonicalResult = runCli(manifestPath, indexPath);
    assert.notEqual(canonicalResult.status, 0);
    assert.match(canonicalResult.stderr, /outside the canonical sample root/);
    assert.deepEqual(fs.readFileSync(indexPath), originalIndex);
  });
});

test("CLI rejects a symlink ancestor targeting canonical sample authority", (context) => {
  usingFixture(({ directory, manifestPath }) => {
    const linkedRoot = path.join(directory, "sample-root-link");
    try {
      fs.symlinkSync(path.dirname(indexPath), linkedRoot, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const escapedOutput = path.join(linkedRoot, "new-output-dir", "report.json");
    const result = runCli(manifestPath, escapedOutput);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the canonical sample root/);
    assert.equal(fs.existsSync(path.join(path.dirname(indexPath), "new-output-dir")), false);
  });
});

function usingFixture(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-toolkit-readiness-"));
  try {
    const runPath = path.join(directory, "scoring.sample-run-record.json");
    const feedbackPath = path.join(directory, "feedback-parse-result.json");
    const inventoryPath = path.join(directory, "readiness-case-inventory.json");
    const manifestPath = path.join(directory, "readiness-input.json");
    const run = compileSampleRun({
      sampleId: "synthetic-linear-equation",
      runMode: "scoring",
      candidatePath,
      truthExtractionStatus: "ok",
      inputAnswerLeakage: "none",
      iteration: 1
    });
    writeJson(runPath, run);
    writeJson(feedbackPath, compileFeedbackParseResult({
      runPath,
      createdAt: "2026-07-26T12:00:00.000Z"
    }));
    const inventory = {
      schemaVersion: "1.0",
      kind: "optimization-readiness-case-inventory",
      evaluationId: "synthetic-readiness",
      cases: [{
        caseId: "synthetic-linear-equation-perturbed",
        sampleId: run.sampleId,
        candidateSourceType: run.candidateSourceType,
        candidateDescriptorRef: run.candidateDescriptorRef,
        candidateDescriptorSha256: run.candidateDescriptorSha256,
        expectedError: true,
        truthExtractionStatus: run.truthExtractionStatus,
        inputAnswerLeakage: run.inputAnswerLeakage
      }]
    };
    writeJson(inventoryPath, inventory);
    const manifest = {
      schemaVersion: "1.0",
      kind: "optimization-readiness-input",
      evaluationId: "synthetic-readiness",
      caseInventoryRef: path.basename(inventoryPath),
      caseInventorySha256: sha256File(inventoryPath),
      toolchainStatus: "not_verified",
      restrictedEgressStatus: "not_verified",
      cases: [{
        caseId: "synthetic-linear-equation-perturbed",
        runRef: path.basename(runPath),
        runSha256: sha256File(runPath),
        feedbackRef: path.basename(feedbackPath),
        feedbackSha256: sha256File(feedbackPath)
      }]
    };
    writeJson(manifestPath, manifest);
    action({
      directory,
      runPath,
      feedbackPath,
      inventoryPath,
      manifestPath,
      inventory,
      manifest,
      run
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(manifestPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "optimization-readiness.mjs"),
      "--manifest", manifestPath,
      "--out", outputPath
    ],
    { cwd: repoRoot, encoding: "utf8" });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function attachSyntheticControlReceipt(directory, manifest) {
  const gateSequence = gateDefinitions.map((gate, index) => {
    const logRef = `control-${String(index + 1).padStart(2, "0")}-${gate.gateId}.log`;
    const logPath = path.join(directory, logRef);
    fs.writeFileSync(logPath, `${gate.gateId} synthetic contract log\n`);
    return {
      ...gate,
      exitCode: 0,
      logRef,
      logSha256: sha256File(logPath)
    };
  });
  const receipt = {
    schemaVersion: "1.0",
    kind: "readiness-control-receipt",
    receiptId: "readiness-control-fedcba9876543210",
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
  writeJson(receiptPath, receipt);
  manifest.controlReceiptRef = path.basename(receiptPath);
  manifest.controlReceiptSha256 = sha256File(receiptPath);
  return receipt;
}
