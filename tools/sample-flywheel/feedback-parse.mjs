import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import {
  getCanonicalSampleAuthorityPaths,
  validateSampleRunRecord
} from "./sample-run.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const sampleRoot = fs.realpathSync.native(path.join(repoRoot, "样例交付"));
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const feedbackRecordSchema = path.join(schemaRoot, "feedback-record.schema.json");
const feedbackParseResultSchema = path.join(schemaRoot, "feedback-parse-result.schema.json");
const errorTypes = new Set([
  "spec_gap",
  "rule_gap",
  "routing_error",
  "visual_error",
  "ocr_error",
  "reference_parse_error",
  "reasoning_error",
  "format_error",
  "data_quality_issue"
]);
const severities = new Set(["low", "medium", "high", "critical"]);
const sha256Pattern = /^[a-f0-9]{64}$/;

export function compileFeedbackParseResult(options = {}) {
  const sourceRunArtifact = readJsonArtifact(options.runPath, "source SampleRunRecord");
  const sourceRun = sourceRunArtifact.value;
  validateSampleRunRecord(sourceRun);
  validateFeedbackSourceAdmission(sourceRun);
  const createdAt = requireCanonicalTimestamp(options.createdAt, "createdAt");
  const rootCause = sourceRun.rootCauseSummary;
  const feedbackRecord = {
    schemaVersion: "1.0",
    kind: "feedback-record",
    feedbackId: `feedback-${sourceRunArtifact.sha256.slice(0, 16)}`,
    subjectPack: sourceRun.subjectPack,
    source: "auto_collected",
    primaryErrorType: rootCause.primaryErrorType,
    contributingErrorTypes: [...rootCause.contributingErrorTypes],
    confidence: rootCause.labelConfidence,
    severity: rootCause.expectedSeverity,
    evidence: {
      method: sourceRun.diffSummary.method,
      candidateSha256: sourceRun.diffSummary.candidateSha256,
      referenceSha256: sourceRun.diffSummary.referenceSha256,
      candidateDescriptorSha256: sourceRun.candidateDescriptorSha256,
      labelSource: rootCause.labelSource,
      expectedDiffLayer: rootCause.expectedDiffLayer
    },
    reproInput: {
      sampleId: sourceRun.sampleId,
      iteration: sourceRun.iteration,
      candidateArtifactRef: sourceRun.candidateArtifactRef
    },
    firstObservedIteration: sourceRun.iteration,
    createdAt
  };
  const result = {
    schemaVersion: "2.0",
    kind: "feedback-parse-result",
    sampleId: sourceRun.sampleId,
    subjectPack: sourceRun.subjectPack,
    parseMode: "synthetic_fixture_label",
    parseDisposition: "parsed",
    sourceRunSha256: sourceRunArtifact.sha256,
    sampleIndexSha256: sourceRun.sampleIndexSha256,
    samplePackageSha256: sourceRun.samplePackageSha256,
    candidateDescriptorSha256: sourceRun.candidateDescriptorSha256,
    feedbackRecords: [feedbackRecord],
    optimizationCandidateRefs: [],
    stopReason: "feedback_recorded_no_optimizer"
  };

  validateFeedbackParseResult(result, sourceRunArtifact.path);
  return result;
}

export function validateFeedbackParseResult(result, sourceRunPath) {
  assertSchema("FeedbackParseResult", result, feedbackParseResultSchema);
  if (result.schemaVersion !== "2.0") {
    throw new Error("FeedbackParseResult schemaVersion is unsupported.");
  }
  const sourceRunArtifact = readJsonArtifact(sourceRunPath, "source SampleRunRecord");
  const sourceRun = sourceRunArtifact.value;
  validateSampleRunRecord(sourceRun);
  validateFeedbackSourceAdmission(sourceRun);

  if (result.sourceRunSha256 !== sourceRunArtifact.sha256) {
    throw new Error("FeedbackParseResult sourceRunSha256 does not match source run bytes.");
  }
  for (const [field, expected] of [
    ["sampleId", sourceRun.sampleId],
    ["subjectPack", sourceRun.subjectPack],
    ["sampleIndexSha256", sourceRun.sampleIndexSha256],
    ["samplePackageSha256", sourceRun.samplePackageSha256],
    ["candidateDescriptorSha256", sourceRun.candidateDescriptorSha256]
  ]) {
    if (result[field] !== expected) {
      throw new Error(`FeedbackParseResult ${field} does not match source run.`);
    }
  }
  if (result.parseMode !== "synthetic_fixture_label") {
    throw new Error("FeedbackParseResult parseMode is unsupported.");
  }
  if (result.parseDisposition !== "parsed"
    || result.sourceFeedbackId !== undefined
    || result.sourceFeedbackSha256 !== undefined
    || result.humanQueue !== undefined
    || result.reasonCode !== undefined) {
    throw new Error("fixture FeedbackParseResult has unsupported teacher-text fields.");
  }
  if (!Array.isArray(result.optimizationCandidateRefs)
    || result.optimizationCandidateRefs.length !== 0) {
    throw new Error("FeedbackParseResult optimizationCandidateRefs must remain empty.");
  }
  if (result.stopReason !== "feedback_recorded_no_optimizer") {
    throw new Error("FeedbackParseResult stopReason is unsupported.");
  }
  if (!Array.isArray(result.feedbackRecords) || result.feedbackRecords.length !== 1) {
    throw new Error("FeedbackParseResult requires exactly one fixture feedback record.");
  }

  const feedbackRecord = result.feedbackRecords[0];
  assertSchema("feedback record", feedbackRecord, feedbackRecordSchema);
  validateFeedbackRecord(feedbackRecord, sourceRun, sourceRunArtifact.sha256);
  return result;
}

export function validateFeedbackSourceAdmission(sourceRun) {
  if (sourceRun.runMode !== "scoring") {
    throw new Error("feedback parsing requires a scoring SampleRunRecord.");
  }
  if (sourceRun.diffSummary.exactMatch) {
    throw new Error("feedback parsing requires a non-exact scoring result.");
  }
  if (sourceRun.rootCauseSummary?.labelSource !== "negative_candidate_fixture"
    || sourceRun.rootCauseSummary.detected !== true) {
    throw new Error("feedback parsing requires a detected synthetic fixture label.");
  }
  requireErrorType(sourceRun.rootCauseSummary.primaryErrorType, "primaryErrorType");
  requireUniqueErrorTypes(
    sourceRun.rootCauseSummary.contributingErrorTypes,
    "contributingErrorTypes",
    sourceRun.rootCauseSummary.primaryErrorType);
  requireSeverity(sourceRun.rootCauseSummary.expectedSeverity);
  requireConfidence(sourceRun.rootCauseSummary.labelConfidence);
  if (!Array.isArray(sourceRun.optimizationCandidateRefs)
    || sourceRun.optimizationCandidateRefs.length !== 0) {
    throw new Error("source SampleRunRecord optimizationCandidateRefs must remain empty.");
  }
}

function validateFeedbackRecord(feedbackRecord, sourceRun, sourceRunSha256) {
  const expectedFeedbackId = `feedback-${sourceRunSha256.slice(0, 16)}`;
  if (feedbackRecord.feedbackId !== expectedFeedbackId) {
    throw new Error("feedback record ID does not match source run bytes.");
  }
  if (feedbackRecord.subjectPack !== sourceRun.subjectPack
    || feedbackRecord.source !== "auto_collected") {
    throw new Error("feedback record identity does not match source run.");
  }
  if (feedbackRecord.primaryErrorType !== sourceRun.rootCauseSummary.primaryErrorType
    || !isDeepStrictEqual(
      feedbackRecord.contributingErrorTypes,
      sourceRun.rootCauseSummary.contributingErrorTypes)
    || feedbackRecord.confidence !== sourceRun.rootCauseSummary.labelConfidence
    || feedbackRecord.severity !== sourceRun.rootCauseSummary.expectedSeverity) {
    throw new Error("feedback record attribution does not match source root cause.");
  }
  if (feedbackRecord.errorType !== undefined
    && feedbackRecord.errorType !== feedbackRecord.primaryErrorType) {
    throw new Error("feedback record errorType compatibility alias must match primaryErrorType.");
  }
  requireCanonicalTimestamp(feedbackRecord.createdAt, "feedback record createdAt");
  if (feedbackRecord.firstObservedIteration !== sourceRun.iteration) {
    throw new Error("feedback record firstObservedIteration does not match source run.");
  }
  const expectedEvidence = {
    method: sourceRun.diffSummary.method,
    candidateSha256: sourceRun.diffSummary.candidateSha256,
    referenceSha256: sourceRun.diffSummary.referenceSha256,
    candidateDescriptorSha256: sourceRun.candidateDescriptorSha256,
    labelSource: sourceRun.rootCauseSummary.labelSource,
    expectedDiffLayer: sourceRun.rootCauseSummary.expectedDiffLayer
  };
  if (!isDeepStrictEqual(feedbackRecord.evidence, expectedEvidence)) {
    throw new Error("feedback record evidence does not match source run.");
  }
  const expectedReproInput = {
    sampleId: sourceRun.sampleId,
    iteration: sourceRun.iteration,
    candidateArtifactRef: sourceRun.candidateArtifactRef
  };
  if (!isDeepStrictEqual(feedbackRecord.reproInput, expectedReproInput)) {
    throw new Error("feedback record reproInput does not match source run.");
  }
}

function requireErrorType(value, label) {
  if (!errorTypes.has(value)) {
    throw new Error(`${label} must be a supported feedback error type.`);
  }
}

function requireUniqueErrorTypes(values, label, primaryErrorType) {
  if (!Array.isArray(values)
    || values.some((value) => !errorTypes.has(value))
    || new Set(values).size !== values.length
    || values.includes(primaryErrorType)) {
    throw new Error(`${label} must contain unique supported types and exclude primaryErrorType.`);
  }
}

function requireSeverity(value) {
  if (!severities.has(value)) {
    throw new Error("expectedSeverity must be a supported severity.");
  }
}

function requireConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("labelConfidence must be a finite number from 0 to 1.");
  }
}

function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp.`);
  }
  return value;
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = requireFile(path.resolve(requireText(filePath, label)), label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.realpathSync.native(filePath);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
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

function assertOutputDoesNotAliasInputs(outputPath, sourceRunPath, sampleId) {
  const resolvedOutputPath = path.resolve(requireText(outputPath, "--out"));
  if (path.extname(resolvedOutputPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }
  const sourcePath = requireFile(path.resolve(requireText(sourceRunPath, "--run")), "source SampleRunRecord");
  if (pathIsWithin(resolvedOutputPath, sampleRoot)) {
    throw new Error("--out must remain outside the canonical sample root.");
  }
  const protectedInputs = [
    sourcePath,
    ...getCanonicalSampleAuthorityPaths(sampleId)
  ];
  const outputCanonical = canonicalPath(resolvedOutputPath);
  const outputIdentity = fileIdentity(resolvedOutputPath);
  if (protectedInputs.some((inputPath) =>
    outputCanonical === canonicalPath(inputPath)
    || sameFileIdentity(outputIdentity, fileIdentity(inputPath)))) {
    throw new Error("--out must not alias the source run or canonical sample authority.");
  }
}

function pathIsWithin(filePath, allowedRoot) {
  const canonicalRoot = fs.realpathSync.native(allowedRoot);
  const canonicalCandidate = canonicalPath(filePath);
  const relativePath = path.relative(normalizePath(canonicalRoot), canonicalCandidate);
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
  const parentPath = path.dirname(resolvedPath);
  const canonicalParent = fs.existsSync(parentPath)
    ? fs.realpathSync.native(parentPath)
    : path.resolve(parentPath);
  return normalizePath(path.join(canonicalParent, path.basename(resolvedPath)));
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueFlags = {
      "--run": "runPath",
      "--created-at": "createdAt",
      "--out": "outPath"
    };
    if (valueFlags[arg]) {
      options[valueFlags[arg]] = requireText(argv[++index], arg);
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
  const result = compileFeedbackParseResult(options);
  assertOutputDoesNotAliasInputs(options.outPath, options.runPath, result.sampleId);
  atomicWriteJson(options.outPath, result);
  process.stdout.write(`${path.resolve(options.outPath)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
