import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDirectory, "..", "..");
const baselineDirectory = path.join(moduleDirectory, "baselines");
const allowedStageStatuses = new Set(["evaluated", "not_run"]);
const allowedCaseResults = new Set(["pass", "fail", "not_evaluated"]);
const allowedModels = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
const allowedReasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);

function fail(message) {
  throw new Error(message);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resolveRepoFile(repoRoot, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.trim().length === 0 || path.isAbsolute(relativePath)) {
    fail(`${label}.path must be a non-empty repository-relative path.`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  const prefix = `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    fail(`${label}.path escapes the repository root.`);
  }
  return resolved;
}

function validateFileBinding(binding, label) {
  if (!binding || typeof binding !== "object") fail(`${label} is required.`);
  if (typeof binding.path !== "string") fail(`${label}.path is required.`);
  if (!isSha256(binding.sha256)) fail(`${label}.sha256 must be a lowercase SHA-256 digest.`);
}

export function validateBaselineShape(baseline) {
  if (baseline?.schemaVersion !== "1.0" || baseline?.kind !== "real-paper-eval-baseline") {
    fail("Baseline kind/schemaVersion is invalid.");
  }
  if (!Number.isInteger(baseline.year) || typeof baseline.id !== "string" || typeof baseline.subjectPack !== "string") {
    fail("Baseline id, year, and subjectPack are required.");
  }
  if (typeof baseline.comparisonKey !== "string" || baseline.comparisonKey.length === 0) {
    fail("comparisonKey is required.");
  }
  if (!Array.isArray(baseline.targetQuestions) || baseline.targetQuestions.length === 0
      || baseline.targetQuestions.some((value) => !Number.isInteger(value))) {
    fail("targetQuestions must be a non-empty integer array.");
  }

  validateFileBinding(baseline.authority?.sourceExam, "authority.sourceExam");
  validateFileBinding(baseline.authority?.referenceAnswer, "authority.referenceAnswer");
  if (typeof baseline.evidenceRef !== "string" || baseline.evidenceRef.length === 0) {
    fail("evidenceRef is required.");
  }

  const expectedQuestions = baseline.targetQuestions.map(String).sort();
  for (const stageName of ["blind", "visualAudit", "referenceReview"]) {
    const stage = baseline.stages?.[stageName];
    if (!stage || !allowedStageStatuses.has(stage.status)) fail(`${stageName}.status is invalid.`);
    const actualQuestions = Object.keys(stage.cases ?? {}).sort();
    if (JSON.stringify(actualQuestions) !== JSON.stringify(expectedQuestions)) {
      fail(`${stageName}.cases must cover exactly targetQuestions.`);
    }
    for (const [question, result] of Object.entries(stage.cases)) {
      if (!allowedCaseResults.has(result)) fail(`${stageName}.cases.${question} is invalid.`);
      if (stage.status === "not_run" && result !== "not_evaluated") {
        fail(`${stageName} is not_run, so every case must be not_evaluated.`);
      }
      if (stage.status === "evaluated" && result === "not_evaluated") {
        fail(`${stageName} is evaluated, so no case may be not_evaluated.`);
      }
    }
    if (stage.status === "evaluated") validateFileBinding(stage.artifact, `stages.${stageName}.artifact`);
    if (stage.status === "evaluated") {
      if (!allowedModels.has(stage.execution?.model)
          || !allowedReasoningEfforts.has(stage.execution?.reasoningEffort)) {
        fail(`${stageName}.execution must identify one supported model tier.`);
      }
    }
    if (stage.status === "not_run" && (stage.artifact !== null || stage.execution !== null)) {
      fail(`${stageName}.artifact and execution must be null when not_run.`);
    }
  }

  if (Object.values(baseline.stages.referenceReview.cases).some((result) => result !== "pass")) {
    fail("referenceReview must record pass for every target question in a verified baseline.");
  }
  if (typeof baseline.teacherAccepted !== "boolean") fail("teacherAccepted must be boolean.");
  return baseline;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function validateBaselineFiles(baseline, repoRoot = defaultRepoRoot) {
  validateBaselineShape(baseline);
  const bindings = [
    [baseline.authority.sourceExam, "authority.sourceExam"],
    [baseline.authority.referenceAnswer, "authority.referenceAnswer"]
  ];
  for (const [stageName, stage] of Object.entries(baseline.stages)) {
    if (stage.status === "evaluated") bindings.push([stage.artifact, `stages.${stageName}.artifact`]);
  }
  for (const [binding, label] of bindings) {
    const filePath = resolveRepoFile(repoRoot, binding.path, label);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`${label} file is missing: ${binding.path}`);
    const actual = sha256File(filePath);
    if (actual !== binding.sha256) fail(`${label} SHA-256 mismatch: expected ${binding.sha256}, got ${actual}`);
  }
  const evidencePath = resolveRepoFile(repoRoot, baseline.evidenceRef, "evidenceRef");
  if (!fs.existsSync(evidencePath)) fail(`evidenceRef file is missing: ${baseline.evidenceRef}`);
  return baseline;
}

export function loadBaselines(directory = baselineDirectory) {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
}

function tierId(execution) {
  return `${execution.model}/${execution.reasoningEffort}`;
}

export function evaluateModelTierEvidence(baselines, stageName = "blind") {
  const groups = new Map();
  for (const baseline of baselines) {
    const stage = baseline.stages?.[stageName];
    if (stage?.status !== "evaluated") continue;
    const group = groups.get(baseline.comparisonKey) ?? [];
    group.push({ baseline, stage, tier: tierId(stage.execution) });
    groups.set(baseline.comparisonKey, group);
  }
  const comparableGroups = [...groups.entries()]
    .map(([comparisonKey, entries]) => ({ comparisonKey, entries, tiers: [...new Set(entries.map((entry) => entry.tier))] }))
    .filter((group) => group.tiers.length >= 2);
  if (comparableGroups.length < 2) {
    return {
      status: "insufficient_comparative_evidence",
      stage: stageName,
      comparableGroups: comparableGroups.length,
      requiredComparableGroups: 2,
      recommendation: null
    };
  }

  const scores = new Map();
  for (const group of comparableGroups) {
    for (const entry of group.entries) {
      const outcomes = Object.values(entry.stage.cases);
      const score = scores.get(entry.tier) ?? { passes: 0, evaluated: 0, comparisonKeys: new Set() };
      score.passes += outcomes.filter((outcome) => outcome === "pass").length;
      score.evaluated += outcomes.length;
      score.comparisonKeys.add(group.comparisonKey);
      scores.set(entry.tier, score);
    }
  }
  const eligible = [...scores.entries()]
    .filter(([, score]) => score.comparisonKeys.size >= 2)
    .map(([tier, score]) => ({ tier, accuracy: score.passes / score.evaluated, evaluated: score.evaluated }))
    .sort((left, right) => right.accuracy - left.accuracy || right.evaluated - left.evaluated || left.tier.localeCompare(right.tier));
  if (eligible.length < 2 || eligible[0].accuracy === eligible[1].accuracy) {
    return {
      status: eligible.length < 2 ? "insufficient_comparative_evidence" : "no_unique_winner",
      stage: stageName,
      comparableGroups: comparableGroups.length,
      requiredComparableGroups: 2,
      recommendation: null
    };
  }
  return {
    status: "recommendation_available",
    stage: stageName,
    comparableGroups: comparableGroups.length,
    requiredComparableGroups: 2,
    recommendation: eligible[0]
  };
}

function main() {
  const baselines = loadBaselines();
  for (const baseline of baselines) validateBaselineFiles(baseline, defaultRepoRoot);
  const summary = baselines.map((baseline) => ({
    id: baseline.id,
    blindFailures: Object.values(baseline.stages.blind.cases).filter((value) => value === "fail").length,
    visualAuditStatus: baseline.stages.visualAudit.status,
    visualAuditFailures: Object.values(baseline.stages.visualAudit.cases).filter((value) => value === "fail").length,
    referencePasses: Object.values(baseline.stages.referenceReview.cases).filter((value) => value === "pass").length,
    teacherAccepted: baseline.teacherAccepted
  }));
  console.log(JSON.stringify({
    ok: true,
    baselines: summary,
    modelTierEvidence: ["blind", "visualAudit", "referenceReview"].map((stage) => evaluateModelTierEvidence(baselines, stage))
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
