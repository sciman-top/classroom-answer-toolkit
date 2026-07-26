import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { validateFeedbackParseResult } from "./feedback-parse.mjs";
import {
  getReadinessControlReceiptPaths,
  validateReadinessControlReceipt
} from "./readiness-control-receipt.mjs";
import {
  getCanonicalSampleCandidateAuthority,
  getCanonicalSampleAuthorityPaths,
  validateSampleRunRecord
} from "./sample-run.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const sampleRoot = fs.realpathSync.native(path.join(repoRoot, "样例交付"));
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const caseInventorySchema = path.join(
  schemaRoot,
  "optimization-readiness-case-inventory.schema.json");
const inputSchema = path.join(schemaRoot, "optimization-readiness-input.schema.json");
const reportSchema = path.join(schemaRoot, "optimization-readiness-report.schema.json");
const bucketOrder = [
  "perturbed_negative",
  "historical_candidate",
  "generated"
];
const thresholds = {
  perturbedNegativeRecall: 0.8,
  nonPerturbedMinimumSampleCount: 3,
  nonPerturbedRecall: 0.7
};
const sha256Pattern = /^[a-f0-9]{64}$/;

export function compileOptimizationReadinessReport(options = {}) {
  const manifestArtifact = readJsonArtifact(options.manifestPath, "readiness input manifest");
  const evaluation = evaluateManifest(manifestArtifact, {
    requireCurrentSource: options.requireCurrentControlSource !== false
  });
  const report = {
    schemaVersion: "2.0",
    kind: "optimization-readiness-report",
    evaluationId: manifestArtifact.value.evaluationId,
    sourceManifestSha256: manifestArtifact.sha256,
    thresholds: { ...thresholds },
    controls: {
      ...evaluation.controls
    },
    caseBindings: evaluation.caseBindings,
    buckets: evaluation.buckets,
    unresolvedLeakageCount: evaluation.unresolvedLeakageCount,
    eligible: evaluation.reasonCodes.length === 0,
    reasonCodes: evaluation.reasonCodes,
    optimizationCandidateRefs: []
  };

  validateOptimizationReadinessReport(report, manifestArtifact.path, {
    requireCurrentControlSource: options.requireCurrentControlSource
  });
  return report;
}

export function validateOptimizationReadinessReport(report, manifestPath, options = {}) {
  assertSchema("OptimizationReadinessReport", report, reportSchema);
  const manifestArtifact = readJsonArtifact(manifestPath, "readiness input manifest");
  const expected = compileExpectedReport(manifestArtifact, {
    requireCurrentSource: options.requireCurrentControlSource !== false
  });
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error("OptimizationReadinessReport does not match its bound manifest and current authority.");
  }
  if (!Array.isArray(report.optimizationCandidateRefs)
    || report.optimizationCandidateRefs.length !== 0) {
    throw new Error("OptimizationReadinessReport optimizationCandidateRefs must remain empty.");
  }
  return report;
}

export function validateOptimizationReadinessInput(manifest, manifestPath) {
  assertSchema("OptimizationReadinessInput", manifest, inputSchema);
  if (manifest.schemaVersion !== "1.0") {
    throw new Error("OptimizationReadinessInput schemaVersion is unsupported.");
  }
  const manifestDirectory = fs.realpathSync.native(path.dirname(manifestPath));
  if (manifest.caseInventoryRef !== "readiness-case-inventory.json") {
    throw new Error(
      "caseInventoryRef must identify the canonical sibling readiness-case-inventory.json.");
  }
  assertSha256(manifest.caseInventorySha256, "caseInventorySha256");
  const inventoryPath = resolveContainedRef(
    manifest.caseInventoryRef,
    manifestPath,
    manifestDirectory,
    "caseInventoryRef");
  const inventoryArtifact = readJsonArtifact(inventoryPath, "readiness case inventory");
  if (inventoryArtifact.sha256 !== manifest.caseInventorySha256) {
    throw new Error("caseInventorySha256 does not match readiness case inventory bytes.");
  }
  validateOptimizationReadinessCaseInventory(inventoryArtifact.value);
  if (manifest.evaluationId !== inventoryArtifact.value.evaluationId) {
    throw new Error("OptimizationReadinessInput evaluationId does not match its case inventory.");
  }
  const caseIds = manifest.cases.map((entry) => entry.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("OptimizationReadinessInput caseId values must be unique.");
  }
  const inventoryCaseIds = inventoryArtifact.value.cases.map((entry) => entry.caseId);
  if (!isDeepStrictEqual([...caseIds].sort(), [...inventoryCaseIds].sort())) {
    throw new Error("OptimizationReadinessInput cases must exactly cover its case inventory.");
  }
  if (manifest.toolchainStatus !== "not_verified"
    || manifest.restrictedEgressStatus !== "not_verified") {
    throw new Error("positive control status requires a verifiable receipt and is not supported.");
  }
  const hasControlRef = manifest.controlReceiptRef !== undefined;
  const hasControlSha256 = manifest.controlReceiptSha256 !== undefined;
  if (hasControlRef !== hasControlSha256) {
    throw new Error("controlReceiptRef and controlReceiptSha256 must be provided together.");
  }
  if (hasControlRef) {
    assertSha256(manifest.controlReceiptSha256, "controlReceiptSha256");
    resolveContainedRef(
      manifest.controlReceiptRef,
      manifestPath,
      manifestDirectory,
      "controlReceiptRef");
  }

  const runHashes = [];
  for (const entry of manifest.cases) {
    const hasRunRef = entry.runRef !== undefined;
    const hasRunSha256 = entry.runSha256 !== undefined;
    if (hasRunRef !== hasRunSha256) {
      throw new Error(`${entry.caseId} runRef and runSha256 must be provided together.`);
    }
    if (hasRunSha256) {
      assertSha256(entry.runSha256, `${entry.caseId} runSha256`);
      runHashes.push(entry.runSha256);
    }
    const hasFeedbackRef = entry.feedbackRef !== undefined;
    const hasFeedbackSha256 = entry.feedbackSha256 !== undefined;
    if (hasFeedbackRef !== hasFeedbackSha256) {
      throw new Error(`${entry.caseId} feedbackRef and feedbackSha256 must be provided together.`);
    }
    if (hasFeedbackSha256) {
      assertSha256(entry.feedbackSha256, `${entry.caseId} feedbackSha256`);
    }
    if (hasFeedbackRef && !hasRunRef) {
      throw new Error(`${entry.caseId} feedback binding requires a run binding.`);
    }
    if (hasRunRef) {
      resolveContainedRef(entry.runRef, manifestPath, manifestDirectory, `${entry.caseId} runRef`);
    }
    if (hasFeedbackRef) {
      resolveContainedRef(
        entry.feedbackRef,
        manifestPath,
        manifestDirectory,
        `${entry.caseId} feedbackRef`);
    }
  }
  if (new Set(runHashes).size !== runHashes.length) {
    throw new Error("OptimizationReadinessInput must not reuse a runSha256 across cases.");
  }
  return manifest;
}

export function validateOptimizationReadinessCaseInventory(inventory) {
  assertSchema("OptimizationReadinessCaseInventory", inventory, caseInventorySchema);
  if (inventory.schemaVersion !== "2.0"
    || !Array.isArray(inventory.cases)
    || inventory.cases.length === 0) {
    throw new Error("OptimizationReadinessCaseInventory requires a supported non-empty inventory.");
  }
  const caseIds = inventory.cases.map((entry) => entry.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("OptimizationReadinessCaseInventory caseId values must be unique.");
  }
  const evaluationUnits = [];
  for (const entry of inventory.cases) {
    if (entry.expectedError !== true) {
      throw new Error(`${entry.caseId} expectedError must be true for error-recall readiness.`);
    }
    const authority = getCanonicalSampleCandidateAuthority(
      entry.sampleId,
      entry.candidateDescriptorRef);
    for (const field of [
      "candidateSourceType",
      "candidateDescriptorSha256"
    ]) {
      if (entry[field] !== authority[field]) {
        throw new Error(`${entry.caseId} ${field} does not match current canonical authority.`);
      }
    }
    if (!isDeepStrictEqual(entry.releaseQualification, authority.releaseQualification)) {
      throw new Error(
        `${entry.caseId} releaseQualification does not match current canonical authority.`);
    }
    evaluationUnits.push(`${entry.sampleId}:${entry.candidateDescriptorSha256}`);
  }
  if (new Set(evaluationUnits).size !== evaluationUnits.length) {
    throw new Error(
      "OptimizationReadinessCaseInventory must not repeat a sample and candidate descriptor.");
  }
  return inventory;
}

function compileExpectedReport(manifestArtifact, options) {
  const evaluation = evaluateManifest(manifestArtifact, options);
  return {
    schemaVersion: "2.0",
    kind: "optimization-readiness-report",
    evaluationId: manifestArtifact.value.evaluationId,
    sourceManifestSha256: manifestArtifact.sha256,
    thresholds: { ...thresholds },
    controls: {
      ...evaluation.controls
    },
    caseBindings: evaluation.caseBindings,
    buckets: evaluation.buckets,
    unresolvedLeakageCount: evaluation.unresolvedLeakageCount,
    eligible: evaluation.reasonCodes.length === 0,
    reasonCodes: evaluation.reasonCodes,
    optimizationCandidateRefs: []
  };
}

function evaluateManifest(manifestArtifact, options) {
  const manifest = validateOptimizationReadinessInput(
    manifestArtifact.value,
    manifestArtifact.path);
  const manifestDirectory = fs.realpathSync.native(path.dirname(manifestArtifact.path));
  const inventoryPath = resolveContainedRef(
    manifest.caseInventoryRef,
    manifestArtifact.path,
    manifestDirectory,
    "caseInventoryRef");
  const inventoryArtifact = readJsonArtifact(inventoryPath, "readiness case inventory");
  const inventory = validateOptimizationReadinessCaseInventory(inventoryArtifact.value);
  const controls = evaluateControls(manifest, manifestArtifact.path, manifestDirectory, options);
  const inputByCaseId = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  const counters = new Map(bucketOrder.map((sourceType) => [
    sourceType,
    {
      candidateSourceType: sourceType,
      n: 0,
      expectedErrorCount: 0,
      detectedErrorCount: 0,
      qualifiedN: 0,
      qualifiedExpectedErrorCount: 0,
      qualifiedDetectedErrorCount: 0
    }
  ]));
  const caseBindings = [];
  let unresolvedLeakageCount = 0;
  let missingScoringRunCount = 0;
  let truthNotReadyCount = 0;

  for (const inventoryCase of inventory.cases) {
    const entry = inputByCaseId.get(inventoryCase.caseId);
    const bucket = counters.get(inventoryCase.candidateSourceType);
    bucket.n += 1;
    bucket.expectedErrorCount += 1;
    const isReleaseQualified = inventoryCase.releaseQualification.status === "qualified";
    if (isReleaseQualified) {
      bucket.qualifiedN += 1;
      bucket.qualifiedExpectedErrorCount += 1;
    }
    const caseBinding = {
      caseId: inventoryCase.caseId,
      sampleId: inventoryCase.sampleId,
      candidateSourceType: inventoryCase.candidateSourceType,
      candidateDescriptorSha256: inventoryCase.candidateDescriptorSha256,
      releaseQualification: inventoryCase.releaseQualification,
      expectedError: true,
      detected: false
    };
    if (inventoryCase.inputAnswerLeakage === "suspected_unresolved") {
      unresolvedLeakageCount += 1;
    }
    if (inventoryCase.truthExtractionStatus !== "ok") {
      truthNotReadyCount += 1;
    }
    if (entry.runRef === undefined) {
      missingScoringRunCount += 1;
      caseBindings.push(caseBinding);
      continue;
    }

    const runPath = resolveContainedRef(
      entry.runRef,
      manifestArtifact.path,
      manifestDirectory,
      `${entry.caseId} runRef`);
    const runArtifact = readJsonArtifact(runPath, `${entry.caseId} SampleRunRecord`);
    if (runArtifact.sha256 !== entry.runSha256) {
      throw new Error(`${entry.caseId} runSha256 does not match run bytes.`);
    }
    const run = runArtifact.value;
    validateSampleRunRecord(run);
    if (run.runMode !== "scoring"
      || run.sampleId !== inventoryCase.sampleId
      || run.candidateSourceType !== inventoryCase.candidateSourceType
      || run.candidateDescriptorRef !== inventoryCase.candidateDescriptorRef
      || run.candidateDescriptorSha256 !== inventoryCase.candidateDescriptorSha256
      || !isDeepStrictEqual(run.releaseQualification, inventoryCase.releaseQualification)
      || run.truthExtractionStatus !== inventoryCase.truthExtractionStatus
      || run.inputAnswerLeakage !== inventoryCase.inputAnswerLeakage) {
      throw new Error(`${entry.caseId} SampleRunRecord does not match its inventory case.`);
    }
    caseBinding.runSha256 = runArtifact.sha256;

    if (entry.feedbackRef !== undefined) {
      const feedbackPath = resolveContainedRef(
        entry.feedbackRef,
        manifestArtifact.path,
        manifestDirectory,
        `${entry.caseId} feedbackRef`);
      const feedbackArtifact = readJsonArtifact(
        feedbackPath,
        `${entry.caseId} FeedbackParseResult`);
      if (feedbackArtifact.sha256 !== entry.feedbackSha256) {
        throw new Error(`${entry.caseId} feedbackSha256 does not match feedback bytes.`);
      }
      validateFeedbackParseResult(feedbackArtifact.value, runArtifact.path);
      bucket.detectedErrorCount += 1;
      if (isReleaseQualified) {
        bucket.qualifiedDetectedErrorCount += 1;
      }
      caseBinding.feedbackSha256 = feedbackArtifact.sha256;
      caseBinding.detected = true;
    }
    caseBindings.push(caseBinding);
  }

  const buckets = bucketOrder.map((sourceType) => {
    const counter = counters.get(sourceType);
    const bucket = counter.expectedErrorCount === 0
      ? { ...counter, recallStatus: "unavailable" }
      : {
          ...counter,
          recallStatus: "available",
          recall: counter.detectedErrorCount / counter.expectedErrorCount
        };
    if (counter.qualifiedExpectedErrorCount === 0) {
      return { ...bucket, qualifiedRecallStatus: "unavailable" };
    }
    return {
      ...bucket,
      qualifiedRecallStatus: "available",
      qualifiedRecall:
        counter.qualifiedDetectedErrorCount / counter.qualifiedExpectedErrorCount
    };
  });
  const reasonCodes = computeReasonCodes(
    buckets,
    unresolvedLeakageCount,
    missingScoringRunCount,
    truthNotReadyCount,
    controls.toolchainStatus,
    controls.restrictedEgressStatus,
    controls.receiptStatus);
  return { caseBindings, buckets, unresolvedLeakageCount, reasonCodes, controls };
}

function evaluateControls(manifest, manifestPath, manifestDirectory, options) {
  if (manifest.controlReceiptRef === undefined) {
    return {
      toolchainStatus: "not_verified",
      restrictedEgressStatus: "not_verified"
    };
  }
  const receiptPath = resolveContainedRef(
    manifest.controlReceiptRef,
    manifestPath,
    manifestDirectory,
    "controlReceiptRef");
  const receiptArtifact = readJsonArtifact(receiptPath, "readiness control receipt");
  if (receiptArtifact.sha256 !== manifest.controlReceiptSha256) {
    throw new Error("controlReceiptSha256 does not match receipt bytes.");
  }
  validateReadinessControlReceipt(receiptArtifact.value, receiptArtifact.path, options);
  return {
    toolchainStatus: "not_verified",
    restrictedEgressStatus: "not_verified",
    receiptStatus: "unattested_local_record",
    receiptSha256: receiptArtifact.sha256,
    sourceRevision: receiptArtifact.value.sourceRevision
  };
}

function computeReasonCodes(
  buckets,
  unresolvedLeakageCount,
  missingScoringRunCount,
  truthNotReadyCount,
  toolchainStatus,
  restrictedEgressStatus,
  receiptStatus) {
  const reasons = [];
  const perturbed = buckets[0];
  if (perturbed.recallStatus !== "available") {
    reasons.push("perturbed_negative_recall_unavailable");
  } else if (perturbed.recall < thresholds.perturbedNegativeRecall) {
    reasons.push("perturbed_negative_recall_below_threshold");
  }

  const eligibleNonPerturbed = buckets.slice(1).some((bucket) =>
    bucket.qualifiedN >= thresholds.nonPerturbedMinimumSampleCount
    && bucket.qualifiedRecallStatus === "available"
    && bucket.qualifiedRecall >= thresholds.nonPerturbedRecall);
  if (!eligibleNonPerturbed) {
    const hasEnoughSamples = buckets.slice(1).some((bucket) =>
      bucket.qualifiedN >= thresholds.nonPerturbedMinimumSampleCount);
    reasons.push(hasEnoughSamples
      ? "non_perturbed_qualified_recall_below_threshold"
      : "non_perturbed_qualified_sample_count_insufficient");
  }
  if (toolchainStatus !== "passed") {
    reasons.push(toolchainStatus === "failed" ? "toolchain_failed" : "toolchain_not_verified");
  }
  if (restrictedEgressStatus !== "no_violation_observed") {
    reasons.push(restrictedEgressStatus === "violation"
      ? "restricted_egress_violation"
      : "restricted_egress_not_verified");
  }
  if (unresolvedLeakageCount > 0) {
    reasons.push("unresolved_leakage_present");
  }
  if (truthNotReadyCount > 0) {
    reasons.push("truth_extraction_not_ready_present");
  }
  if (missingScoringRunCount > 0) {
    reasons.push("scoring_run_missing_present");
  }
  if (receiptStatus === "unattested_local_record") {
    reasons.push("control_receipt_unattested");
  }
  return reasons;
}

function resolveContainedRef(reference, ownerPath, allowedRoot, label) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (path.isAbsolute(reference)) {
    throw new Error(`${label} must be relative.`);
  }
  const resolved = requireFile(path.resolve(path.dirname(ownerPath), reference), label);
  const relative = path.relative(
    normalizePath(allowedRoot),
    normalizePath(fs.realpathSync.native(resolved)));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the readiness fixture root.`);
  }
  return resolved;
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = requireFile(path.resolve(requireText(filePath, label)), label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
  return filePath;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function assertOutputDoesNotAliasInputs(outputPath, manifestPath) {
  const resolvedOutputPath = path.resolve(requireText(outputPath, "--out"));
  if (path.extname(resolvedOutputPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }
  if (pathIsWithin(resolvedOutputPath, sampleRoot)) {
    throw new Error("--out must remain outside the canonical sample root.");
  }
  const manifestArtifact = readJsonArtifact(manifestPath, "readiness input manifest");
  validateOptimizationReadinessInput(manifestArtifact.value, manifestArtifact.path);
  const manifestDirectory = fs.realpathSync.native(path.dirname(manifestArtifact.path));
  const inventoryPath = resolveContainedRef(
    manifestArtifact.value.caseInventoryRef,
    manifestArtifact.path,
    manifestDirectory,
    "caseInventoryRef");
  const inventory = readJsonArtifact(inventoryPath, "readiness case inventory").value;
  const protectedInputs = [manifestArtifact.path, inventoryPath];
  if (manifestArtifact.value.controlReceiptRef !== undefined) {
    const receiptPath = resolveContainedRef(
      manifestArtifact.value.controlReceiptRef,
      manifestArtifact.path,
      manifestDirectory,
      "controlReceiptRef");
    const receipt = readJsonArtifact(receiptPath, "readiness control receipt").value;
    protectedInputs.push(...getReadinessControlReceiptPaths(receipt, receiptPath));
  }
  for (const entry of manifestArtifact.value.cases) {
    if (entry.runRef === undefined) {
      continue;
    }
    const runPath = resolveContainedRef(
      entry.runRef,
      manifestArtifact.path,
      manifestDirectory,
      `${entry.caseId} runRef`);
    protectedInputs.push(runPath);
    if (entry.feedbackRef !== undefined) {
      protectedInputs.push(resolveContainedRef(
        entry.feedbackRef,
        manifestArtifact.path,
        manifestDirectory,
        `${entry.caseId} feedbackRef`));
    }
    const run = readJsonArtifact(runPath, `${entry.caseId} SampleRunRecord`).value;
    protectedInputs.push(...getCanonicalSampleAuthorityPaths(run.sampleId));
  }
  for (const entry of inventory.cases) {
    protectedInputs.push(...getCanonicalSampleAuthorityPaths(entry.sampleId));
  }
  const outputCanonical = canonicalPath(resolvedOutputPath);
  const outputIdentity = fileIdentity(resolvedOutputPath);
  if (protectedInputs.some((inputPath) =>
    outputCanonical === canonicalPath(inputPath)
    || sameFileIdentity(outputIdentity, fileIdentity(inputPath)))) {
    throw new Error("--out must not alias readiness inputs or canonical sample authority.");
  }
  return outputCanonical;
}

function pathIsWithin(filePath, allowedRoot) {
  const relativePath = path.relative(normalizePath(allowedRoot), canonicalPath(filePath));
  return relativePath === ""
    || (!relativePath.startsWith(`..${path.sep}`)
      && relativePath !== ".."
      && !path.isAbsolute(relativePath));
}

function canonicalPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return normalizePath(fs.realpathSync.native(resolvedPath));
  }
  let existing = resolvedPath;
  const missing = [];
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) {
      break;
    }
    existing = parent;
  }
  return normalizePath(path.join(fs.realpathSync.native(existing), ...missing));
}

function fileIdentity(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return undefined;
  }
  const stat = fs.statSync(filePath, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}

function sameFileIdentity(left, right) {
  return left !== undefined && right !== undefined && left === right;
}

function normalizePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function atomicWriteJson(filePath, value) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, resolvedPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = requireText(argv[++index], arg);
    } else if (arg === "--out") {
      options.outPath = requireText(argv[++index], arg);
    } else if (arg === "--help" || arg === "-h") {
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const report = compileOptimizationReadinessReport(options);
  const safeOutputPath = assertOutputDoesNotAliasInputs(
    options.outPath,
    options.manifestPath);
  atomicWriteJson(safeOutputPath, report);
  process.stdout.write(`${safeOutputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
