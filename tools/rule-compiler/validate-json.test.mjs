import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateValueAgainstSchema } from "./schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const workflowRunSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "live-answer-workflow-run.schema.json");
const summarySchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "live-answer-generation-summary.schema.json");

const sha = "a".repeat(64);

function fileReceipt(name) {
  return { path: `D:\\delivery\\${name}`, bytes: 128, sha256: sha };
}

function phase(status, { summaryPath = "D:\\delivery\\exam.blind-generation.summary.json", artifactPath = "D:\\delivery\\盲答候选.md", error = undefined } = {}) {
  const completed = status === "completed";
  const entry = {
    status,
    summaryPath,
    artifactPath,
    summary: completed && summaryPath ? fileReceipt(path.basename(summaryPath)) : null,
    artifact: completed && artifactPath ? fileReceipt(path.basename(artifactPath)) : null
  };
  if (error) {
    entry.error = error;
  }
  return entry;
}

function buildWorkflowRunReceipt({ status = "succeeded" } = {}) {
  return {
    schemaVersion: "1.0",
    kind: "live-answer-workflow-run",
    runId: "20260825-120000-abcd",
    status,
    startedAt: "2026-08-25T12:00:00.0000000+00:00",
    finishedAt: "2026-08-25T12:03:00.0000000+00:00",
    inputs: {
      sourcePdf: fileReceipt("exam.pdf"),
      referencePdf: null,
      prompt: fileReceipt("prompt.md"),
      blindFocusRegions: null,
      visualAuditFocusRegions: null
    },
    options: {
      provider: "all",
      subjectPack: "junior-physics-answer",
      profile: "classroom",
      blindQualityProfile: "sol-xhigh",
      semanticQualityProfile: "sol-xhigh",
      visualQualityProfile: "sol-xhigh",
      referenceQualityProfile: "sol-xhigh",
      visualDetail: "original",
      maxOutputTokens: 24000,
      timeoutMs: 600000,
      reviewScale: 1.8,
      visualAuditScale: 3.6,
      blindFocusRegionsFile: null,
      visualAuditFocusRegionsFile: null,
      skipVisualAudit: true,
      keepReview: false,
      useGatewayProxy: false,
      configEnvFile: "D:\\repo\\.env"
    },
    phases: {
      blindGeneration: phase(status === "succeeded" ? "completed" : "failed",
        status === "succeeded" ? {} : { error: "Node tool failed with exit code 1" }),
      semanticFindings: phase("skipped", {}),
      semanticMerge: phase("skipped", {}),
      visualFindings: phase("skipped", {}),
      visualMerge: phase("skipped", {}),
      referenceReview: phase("skipped", {}),
      delivery: phase(status === "succeeded" ? "completed" : "pending", {
        summaryPath: null,
        artifactPath: "D:\\delivery\\参考答案.pdf"
      })
    },
    artifacts: status === "succeeded" ? [fileReceipt("参考答案.md"), fileReceipt("参考答案.pdf")] : [],
    diagnostics: { retainedWorkRoot: status === "succeeded" ? null : "D:\\work\\diag" },
    error: status === "succeeded" ? null : "Node tool failed with exit code 1"
  };
}

test("workflow-run schema accepts succeeded and failed receipts", () => {
  for (const status of ["succeeded", "failed"]) {
    const errors = validateValueAgainstSchema(buildWorkflowRunReceipt({ status }), workflowRunSchemaPath);
    assert.deepEqual(errors, [], `receipt(${status}) should validate`);
  }
});

test("workflow-run schema rejects drift", () => {
  const receipt = buildWorkflowRunReceipt();
  receipt.kind = "live-answer-workflow";
  receipt.phases.semanticFindings.status = "done";
  receipt.extraTopLevel = true;
  const errors = validateValueAgainstSchema(receipt, workflowRunSchemaPath);
  assert.ok(errors.some((error) => error.includes("should equal") && error.includes("live-answer-workflow-run")));
  assert.ok(errors.some((error) => error.includes("phases/semanticFindings/status")));
  assert.ok(errors.some((error) => error.includes("unsupported property \"extraTopLevel\"")));
});

function buildSummaryFixture() {
  return {
    schemaVersion: "1.2",
    kind: "live-answer-generation-summary",
    generatedAt: "2026-08-25T12:01:00.000Z",
    provider: "primary",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    promptPath: "prompts/specs/compiled/junior-physics-answer-完整版.md",
    promptSha256: sha,
    mode: "blind_generation",
    sourcePageCount: 8,
    auditImageCount: 0,
    referencePageCount: 0,
    requestedVisualDetailMode: "original",
    providerVisualDetailMode: "original",
    routing: {
      mode: "blind_generation",
      qualityProfile: "sol-xhigh",
      requestedQualityProfile: "sol-xhigh",
      resolvedQualityProfile: "sol-xhigh",
      requestedPreset: "sol",
      resolvedPreset: "sol",
      activePreset: "sol",
      qualityDegraded: false,
      selectedRole: "primary",
      orderedPresets: ["sol", "terra", "luna"],
      orderedRoles: ["primary", "fallback_1"],
      orderedQualityProfiles: ["sol-xhigh", "sol-xhigh"],
      orderedExecutionSlots: [1, 1],
      executionSlot: 1,
      executionSlotCount: 5,
      target: "all",
      resolvedRole: "primary",
      attemptedRoles: ["primary"]
    },
    candidatePath: null,
    candidateSha256: null,
    semanticFindingsPath: null,
    semanticFindingsSha256: null,
    auditFindingsPath: null,
    auditFindingsSha256: null,
    sourceTextPath: null,
    sourceTextSha256: null,
    referenceTextPath: null,
    referenceTextSha256: null,
    pageCount: 8,
    pageImages: [{ path: "D:\\pages\\exam.page-001.png", sha256: sha, evidenceLabel: null }],
    outputPath: "D:\\delivery\\盲答候选.md",
    outputSha256: sha,
    answerCharacters: 4200,
    referenceChoiceOverride: { applied: false },
    semanticChoiceOverride: { applied: false, questions: [] },
    attempts: [{
      provider: "primary",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      preset: "sol",
      qualityProfile: "sol-xhigh",
      executionSlot: 1,
      status: 200,
      retryAfterMs: null,
      ok: true,
      retryable: false,
      attemptNumber: 1,
      durationMs: 1234,
      requestBytes: 9999,
      transport: { applicationTimeoutMs: 600000, headersTimeoutMs: 605000, bodyTimeoutMs: 605000, environmentProxyEnabled: false },
      error: ""
    }]
  };
}

test("summary schema accepts a current blind-generation summary", () => {
  const errors = validateValueAgainstSchema(buildSummaryFixture(), summarySchemaPath);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("summary schema rejects mode drift", () => {
  const summary = buildSummaryFixture();
  summary.mode = "blind";
  summary.pageImages[0].sha256 = "not-hex";
  const errors = validateValueAgainstSchema(summary, summarySchemaPath);
  assert.ok(errors.some((error) => error.includes("$/mode")));
  assert.ok(errors.some((error) => error.includes("pageImages/0/sha256")));
});

test("validate-json CLI reports mismatches with a non-zero exit code", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "validate-json-"));
  try {
    const valuePath = path.join(directory, "instance.json");
    fs.writeFileSync(valuePath, JSON.stringify({ kind: "wrong" }), "utf8");

    const accepted = spawnSync(process.execPath, [path.join(toolDir, "validate-json.mjs"),
      "--schema", workflowRunSchemaPath, "--value", valuePath], { encoding: "utf8" });
    assert.notEqual(accepted.status, 0);
    assert.match(accepted.stderr, /failed schema validation/);

    const missingArgs = spawnSync(process.execPath, [path.join(toolDir, "validate-json.mjs")], { encoding: "utf8" });
    assert.equal(missingArgs.status, 2);
    assert.match(missingArgs.stderr, /Usage:/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
