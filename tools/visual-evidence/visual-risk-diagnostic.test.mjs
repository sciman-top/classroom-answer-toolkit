import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compileVisualRiskDiagnosticReport,
  validateCanonicalVisualRiskFixtures,
  validateVisualRiskDiagnosticReport
} from "./visual-risk-diagnostic.mjs";
import { compileDecisionRecord } from "./decision-record.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const fixtureRoot = path.join(repoRoot, "eval", "visual-evidence", "cases", "visual-risk");
const reportPath = path.join(fixtureRoot, "visual-risk-diagnostic-report.json");
const scriptPath = path.join(import.meta.dirname, "visual-risk-diagnostic.mjs");

test("canonical visual risk authority reports each subject pack independently", () => {
  const report = compileVisualRiskDiagnosticReport();

  assert.equal(report.fixtureSetId, "synthetic-visual-risk-v1");
  assert.equal(report.caseBindings.length, 6);
  assert.equal(report.subjectReports.length, 3);
  for (const subjectReport of report.subjectReports) {
    assert.deepEqual(subjectReport, {
      subjectPack: subjectReport.subjectPack,
      totalCases: 2,
      expectedReviewCount: 2,
      falseReleaseCount: 0,
      falseReleaseRate: 0,
      correctlyFlaggedCount: 2,
      correctFlagRecall: 1,
      bindingCorrectCount: 2,
      bindingAccuracy: 1,
      replayPassedCount: 2,
      replayPassRate: 1
    });
  }
  assert.equal(report.totals.totalCases, 6);
  assert.equal(report.totals.falseReleaseRate, 0);
  assert.equal(report.totals.correctFlagRecall, 1);
  assert.equal(report.totals.bindingAccuracy, 1);
  assert.equal(report.totals.replayPassRate, 1);
  assert.equal(report.caseBindings.filter((binding) => binding.ocrImageConflictDetected).length, 2);
  assert.deepEqual(report.readinessBoundary, {
    toolchainControl: "not_verified",
    restrictedEgressControl: "not_verified",
    eligible: false
  });
  assert.deepEqual(report.optimizationCandidateRefs, []);
});

test("committed visual risk diagnostic report recompiles deterministically", () => {
  const committed = readJson(reportPath);
  assert.deepEqual(compileVisualRiskDiagnosticReport(), committed);
  validateVisualRiskDiagnosticReport(committed);
});

test("visual risk authority fails closed on raw-byte hash drift", () => {
  withFixtureCopy((copyRoot) => {
    const evidencePath = path.join(copyRoot, "math-function-graph-stable.problem-evidence-bundle.json");
    fs.appendFileSync(evidencePath, " ");
    assert.throws(
      () => validateCanonicalVisualRiskFixtures({ fixtureRoot: copyRoot }),
      /bytes do not match inventory hash/);
  });
});

test("schema-valid expected decision mismatch is reported as replay failure", () => {
  withFixtureCopy((copyRoot) => {
    const decisionRef = "math-function-graph-stable.decision-record.json";
    const decisionPath = path.join(copyRoot, decisionRef);
    const decision = readJson(decisionPath);
    writeJson(decisionPath, { ...decision, answer: "schema-valid synthetic expected mismatch" });
    const inventoryPath = path.join(copyRoot, "visual-risk-case-inventory.json");
    const inventory = readJson(inventoryPath);
    inventory.entries[0].expectedDecisionSha256 = sha256File(decisionPath);
    writeJson(inventoryPath, inventory);

    const report = compileVisualRiskDiagnosticReport({ fixtureRoot: copyRoot });
    assert.equal(report.caseBindings[0].replayDisposition, "failed");
    assert.equal(report.subjectReports[0].replayPassRate, 0.5);
    assert.equal(report.totals.replayPassRate, 0.833333);
  });
});

test("visual risk metrics count a schema-valid false release", () => {
  const report = compileVisualRiskDiagnosticReport({
    compileDecision(options) {
      const decision = compileDecisionRecord(options);
      return {
        ...decision,
        decision: "accept",
        answer: "synthetic injected false release",
        trusted: true,
        visualReviewPassed: true,
        reviewRequired: false,
        reviewQueue: "none",
        statusProjection: { visualReviewPassed: true, trusted: true }
      };
    }
  });

  assert.equal(report.totals.falseReleaseCount, 6);
  assert.equal(report.totals.falseReleaseRate, 1);
  assert.equal(report.totals.correctlyFlaggedCount, 0);
  assert.equal(report.totals.correctFlagRecall, 0);
  assert.equal(report.totals.replayPassRate, 0);
});

test("visual risk authority rejects OCR conflict expectation drift", () => {
  withFixtureCopy((copyRoot) => {
    const inventoryPath = path.join(copyRoot, "visual-risk-case-inventory.json");
    const inventory = readJson(inventoryPath);
    inventory.entries[0].expectedOcrImageConflict = true;
    writeJson(inventoryPath, inventory);

    assert.throws(
      () => compileVisualRiskDiagnosticReport({ fixtureRoot: copyRoot }),
      /OCR\/image conflict result does not match inventory expectation/);
  });
});

test("visual risk metrics detect expected binding mismatch", () => {
  withFixtureCopy((copyRoot) => {
    const inventoryPath = path.join(copyRoot, "visual-risk-case-inventory.json");
    const inventory = readJson(inventoryPath);
    inventory.entries[0].expectedBinding.questionRef = "SYN-MATH-WRONG";
    writeJson(inventoryPath, inventory);

    const report = compileVisualRiskDiagnosticReport({ fixtureRoot: copyRoot });
    assert.equal(report.caseBindings[0].bindingCorrect, false);
    assert.equal(report.subjectReports[0].bindingAccuracy, 0.5);
    assert.equal(report.totals.bindingAccuracy, 0.833333);
  });
});

test("visual risk inventory rejects incomplete authority coverage", () => {
  withFixtureCopy((copyRoot) => {
    fs.copyFileSync(
      path.join(copyRoot, "math-function-graph-stable.track-a.json"),
      path.join(copyRoot, "unlisted.track-a.json"));
    assert.throws(
      () => validateCanonicalVisualRiskFixtures({ fixtureRoot: copyRoot }),
      /must exactly cover canonical/);
  });
});

test("visual risk inventory rejects unlisted nested authority", () => {
  withFixtureCopy((copyRoot) => {
    const nestedRoot = path.join(copyRoot, "nested");
    fs.mkdirSync(nestedRoot);
    fs.copyFileSync(
      path.join(copyRoot, "math-function-graph-stable.track-a.json"),
      path.join(nestedRoot, "unlisted.track-a.json"));
    assert.throws(
      () => validateCanonicalVisualRiskFixtures({ fixtureRoot: copyRoot }),
      /must exactly cover canonical/);
  });
});

test("visual risk inventory rejects hardlink authority aliases", (context) => {
  withFixtureCopy((copyRoot) => {
    const sourceRef = "math-function-graph-stable.track-a.json";
    const aliasRef = "math-function-graph-stable.track-b.json";
    try {
      fs.linkSync(path.join(copyRoot, sourceRef), path.join(copyRoot, aliasRef));
    } catch (error) {
      context.skip(`hardlink capability unavailable: ${error.code ?? error.message}`);
      return;
    }
    const inventoryPath = path.join(copyRoot, "visual-risk-case-inventory.json");
    const inventory = readJson(inventoryPath);
    inventory.entries[0].trackResultBindings.push({
      trackType: "ocr_layout_solver",
      trackResultRef: aliasRef,
      trackResultSha256: sha256File(path.join(copyRoot, aliasRef))
    });
    writeJson(inventoryPath, inventory);

    assert.throws(
      () => validateCanonicalVisualRiskFixtures({ fixtureRoot: copyRoot }),
      /aliases another visual risk authority file by physical identity/);
  });
});

test("visual risk report validator rejects computed field drift", () => {
  const report = compileVisualRiskDiagnosticReport();
  assert.throws(
    () => validateVisualRiskDiagnosticReport({
      ...report,
      totals: { ...report.totals, falseReleaseCount: 1 }
    }),
    /does not match canonical visual-risk authority bytes/);
  assert.throws(
    () => validateVisualRiskDiagnosticReport({
      ...report,
      optimizationCandidateRefs: ["optimization-candidate.json"]
    }),
    /schema validation failed/);
  assert.throws(
    () => validateVisualRiskDiagnosticReport({
      ...report,
      readinessBoundary: { ...report.readinessBoundary, eligible: true }
    }),
    /schema validation failed/);
});

test("visual risk CLI writes only outside the repository", () => {
  const rejectedPath = path.join(repoRoot, ".eval-work", "visual-risk-report.json");
  const rejected = spawnSync(process.execPath, [scriptPath, "--out", rejectedPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /outside the repository root/);
  assert.equal(fs.existsSync(rejectedPath), false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visual-risk-cli-"));
  try {
    const outputPath = path.join(tempRoot, "report.json");
    const accepted = spawnSync(process.execPath, [scriptPath, "--out", outputPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(readJson(outputPath), compileVisualRiskDiagnosticReport());
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function withFixtureCopy(action) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visual-risk-fixture-"));
  const copyRoot = path.join(tempRoot, "visual-risk");
  try {
    fs.cpSync(fixtureRoot, copyRoot, { recursive: true });
    action(copyRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
