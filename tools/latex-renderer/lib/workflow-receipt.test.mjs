import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateWorkflowReceipt } from "./workflow-receipt.mjs";

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function receipt(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { path: filePath, bytes: bytes.byteLength, sha256: hash(bytes) };
}

function writeSummary(filePath, outputPath, mode = "blind_generation") {
  const outputBytes = fs.readFileSync(outputPath);
  const candidatePath = mode === "blind_generation" ? null : path.join(path.dirname(filePath), "candidate.md");
  if (candidatePath) {
    fs.writeFileSync(candidatePath, "# reviewed candidate\n");
  }
  const value = {
    schemaVersion: "1.3",
    kind: "live-answer-generation-summary",
    generatedAt: new Date().toISOString(),
    provider: "primary",
    model: "test",
    reasoningEffort: null,
    promptPath: "prompt.md",
    promptSha256: "a".repeat(64),
    mode,
    sourcePageCount: 1,
    auditImageCount: 0,
    referencePageCount: 0,
    requestedVisualDetailMode: "original",
    providerVisualDetailMode: "original",
    routing: {
      mode,
      qualityProfile: "sol-high",
      requestedQualityProfile: "sol-high",
      resolvedQualityProfile: "sol-high",
      requestedPreset: "sol",
      resolvedPreset: "sol",
      activePreset: "sol",
      qualityDegraded: false,
      selectedRole: "primary",
      orderedPresets: ["sol"],
      orderedRoles: ["primary"],
      orderedQualityProfiles: ["sol-high"],
      orderedExecutionSlots: [1],
      executionSlot: 1,
      executionSlotCount: 5,
      target: "primary",
      resolvedRole: "primary",
      attemptedRoles: ["primary"]
    },
    candidatePath: null,
    candidateSha256: null,
    candidateBaselinePath: candidatePath,
    candidateBaselineSha256: candidatePath ? hash(fs.readFileSync(candidatePath)) : null,
    semanticFindingsPath: null,
    semanticFindingsSha256: null,
    auditFindingsPath: null,
    auditFindingsSha256: null,
    sourceTextPath: null,
    sourceTextSha256: null,
    referenceTextPath: null,
    referenceTextSha256: null,
    referencePdfPath: null,
    referencePdfSha256: null,
    pageCount: 1,
    pageImages: [],
    outputPath,
    outputSha256: hash(outputBytes),
    answerCharacters: outputBytes.length,
    referenceChoiceOverride: { applied: false },
    semanticChoiceOverride: { applied: false, questions: [] },
    attempts: [{
      provider: "primary",
      model: "test",
      reasoningEffort: null,
      preset: "sol",
      qualityProfile: "sol-high",
      executionSlot: 1,
      status: 200,
      retryAfterMs: null,
      ok: true,
      retryable: false,
      attemptNumber: 1,
      durationMs: 1,
      requestBytes: 1,
      transport: null,
      error: ""
    }]
  };
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function baseReceipt(root, status = "failed") {
  const answerPath = path.join(root, "answer.md");
  const summaryPath = path.join(root, "summary.json");
  const retainRoot = path.join(root, "failure-diagnostics");
  fs.writeFileSync(answerPath, "# 参考答案\n\n1. A\n");
  writeSummary(summaryPath, answerPath);
  const summary = JSON.parse(fs.readFileSync(summaryPath));
  return {
    schemaVersion: "1.0",
    kind: "live-answer-workflow-run",
    runId: "audit-run",
    status,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    inputs: {
      sourcePdf: null,
      referencePdf: null,
      prompt: null,
      blindFocusRegions: null,
      visualAuditFocusRegions: null,
      configEnv: null
    },
    options: {
      provider: "all",
      subjectPack: "junior-physics-answer",
      profile: "classroom",
      blindQualityProfile: "auto",
      semanticQualityProfile: "auto",
      visualQualityProfile: "auto",
      referenceQualityProfile: "auto",
      visualDetail: "original",
      maxOutputTokens: 24000,
      timeoutMs: 600000,
      reviewScale: 2,
      workflowReviewScale: 2,
      visualAuditScale: 4,
      blindFocusRegionsFile: null,
      visualAuditFocusRegionsFile: null,
      skipVisualAudit: true,
      keepReview: false,
      useGatewayProxy: false,
      allowCloudEgress: true,
      configEnvFile: "config.env",
      optionsFingerprint: "b".repeat(64)
    },
    phases: {
      blindGeneration: {
        status: "completed",
        summaryPath,
        artifactPath: answerPath,
        summary: receipt(summaryPath),
        artifact: receipt(answerPath)
      },
      semanticFindings: { status: "pending", summaryPath: null, artifactPath: null, summary: null, artifact: null },
      semanticMerge: { status: "pending", summaryPath: null, artifactPath: null, summary: null, artifact: null },
      visualFindings: { status: "skipped", summaryPath: null, artifactPath: null, summary: null, artifact: null },
      visualMerge: { status: "skipped", summaryPath: null, artifactPath: null, summary: null, artifact: null },
      referenceReview: { status: "skipped", summaryPath: null, artifactPath: null, summary: null, artifact: null },
      delivery: { status: "pending", summaryPath: null, artifactPath: null, summary: null, artifact: null }
    },
    artifacts: [],
    diagnostics: { retainedWorkRoot: status === "failed" ? retainRoot : null },
    error: status === "failed" ? "fixture failure" : null,
    reviewEvidence: null
  };
}

test("workflow validator accepts a valid AI stage but rejects an incomplete or stale summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-receipt-contract-"));
  try {
    const value = baseReceipt(root);
    assert.deepEqual(validateWorkflowReceipt(value, path.join(root, "workflow.json"), { platform: "linux" }), []);

    const summaryPath = value.phases.blindGeneration.summaryPath;
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    summary.outputSha256 = "0".repeat(64);
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    value.phases.blindGeneration.summary = receipt(summaryPath);
    const errors = validateWorkflowReceipt(
      value,
      path.join(root, "workflow.json"),
      { platform: "linux", validateStages: true }
    );
    assert.ok(errors.some((error) => error.includes("summary.outputSha256")));

    summary.answerCharacters = 0;
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    value.phases.blindGeneration.summary = receipt(summaryPath);
    assert.ok(validateWorkflowReceipt(value, path.join(root, "workflow.json"), { platform: "linux" })
      .some((error) => error.includes("no answer content")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow validator rejects a successful receipt without delivery and review evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-receipt-success-"));
  try {
    const value = baseReceipt(root, "succeeded");
    const errors = validateWorkflowReceipt(value, path.join(root, "workflow.json"), { platform: "linux" });
    assert.ok(errors.some((error) => error.includes("completed delivery phase")
      || error.includes("succeeded workflow must have")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow validator rejects a summary for another mode or a missing candidate receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-receipt-mode-"));
  try {
    const value = baseReceipt(root);
    const summaryPath = value.phases.blindGeneration.summaryPath;
    writeSummary(summaryPath, value.phases.blindGeneration.artifactPath, "semantic_review_merge");
    value.phases.blindGeneration.summary = receipt(summaryPath);
    const errors = validateWorkflowReceipt(value, path.join(root, "workflow.json"), { platform: "linux" });
    assert.ok(errors.some((error) => error.includes("mode does not match")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blind generation cannot claim reviewed candidate evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-receipt-blind-"));
  try {
    const value = baseReceipt(root);
    const summaryPath = value.phases.blindGeneration.summaryPath;
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    summary.candidatePath = summary.outputPath;
    summary.candidateSha256 = summary.outputSha256;
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    value.phases.blindGeneration.summary = receipt(summaryPath);
    const errors = validateWorkflowReceipt(value, path.join(root, "workflow.json"), { platform: "linux" });
    assert.ok(errors.some((error) => error.includes("blindGeneration.summary candidatePath must be null")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
