import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { getCanonicalSampleAuthorityPaths } from "./sample-run.mjs";
import {
  compileTeacherFeedbackParseResult,
  loadCanonicalTeacherFeedbackReplayAuthority,
  validateCanonicalTeacherFeedbackFixtures
} from "./teacher-feedback-parse.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaRoot = path.join(
  repoRoot,
  "prompts",
  "shared",
  "schemas");
const diagnosticSchemaPath = path.join(
  schemaRoot,
  "teacher-feedback-diagnostic-report.schema.json");
const replaySchemaPath = path.join(
  schemaRoot,
  "teacher-feedback-replay-diagnostic-report.schema.json");
const feedbackParseResultSchemaPath = path.join(
  schemaRoot,
  "feedback-parse-result.schema.json");
const fixtureRoot = fs.realpathSync.native(path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-teacher-feedback"));
const inventoryPath = path.join(
  fixtureRoot,
  "teacher-feedback-fixture-inventory.json");
const sampleRoot = fs.realpathSync.native(path.join(repoRoot, "样例交付"));
const errorTypes = [
  "spec_gap",
  "rule_gap",
  "routing_error",
  "visual_error",
  "ocr_error",
  "reference_parse_error",
  "reasoning_error",
  "format_error",
  "data_quality_issue"
];
const severities = ["low", "medium", "high", "critical"];
const reasonCodes = [
  "missing_error_signal",
  "ambiguous_error_signal",
  "negated_error_signal",
  "missing_severity_signal",
  "ambiguous_severity_signal"
];

export function compileTeacherFeedbackDiagnosticReport() {
  const report = buildExpectedReport();
  validateTeacherFeedbackDiagnosticReport(report);
  return report;
}

export function validateTeacherFeedbackDiagnosticReport(report) {
  assertSchema("TeacherFeedbackDiagnosticReport", report, diagnosticSchemaPath);
  const expected = buildExpectedReport();
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error(
      "TeacherFeedbackDiagnosticReport does not match canonical teacher fixture bytes.");
  }
  return report;
}

export function compileTeacherFeedbackReplayDiagnosticReport(options = {}) {
  const compileResult = options.compileResult ?? compileTeacherFeedbackParseResult;
  if (typeof compileResult !== "function") {
    throw new Error("Teacher feedback replay compileResult must be a function.");
  }
  const report = buildExpectedReplayReport(compileResult);
  assertSchema(
    "TeacherFeedbackReplayDiagnosticReport",
    report,
    replaySchemaPath);
  return report;
}

export function validateTeacherFeedbackReplayDiagnosticReport(report) {
  assertSchema(
    "TeacherFeedbackReplayDiagnosticReport",
    report,
    replaySchemaPath);
  const expected = buildExpectedReplayReport(compileTeacherFeedbackParseResult);
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error(
      "TeacherFeedbackReplayDiagnosticReport does not match canonical replay bytes.");
  }
  return report;
}

function buildExpectedReport() {
  const inventory = validateCanonicalTeacherFeedbackFixtures();
  const inventoryArtifact = readJsonArtifact(
    inventoryPath,
    "teacher feedback fixture inventory");
  const errorTypeCounts = emptyCounts(errorTypes);
  const severityCounts = emptyCounts(severities);
  const reasonCodeCounts = emptyCounts(reasonCodes);
  const resultBindings = [];
  let parsedCount = 0;
  let needsHumanLabelCount = 0;

  for (const entry of inventory.entries) {
    const resultArtifact = readJsonArtifact(
      resolveFixtureRef(entry.resultRef, `${entry.fixtureId} resultRef`),
      `${entry.fixtureId} FeedbackParseResult`);
    if (resultArtifact.sha256 !== entry.resultSha256) {
      throw new Error(`${entry.fixtureId} result bytes do not match inventory hash.`);
    }
    const result = resultArtifact.value;
    resultBindings.push({
      fixtureId: entry.fixtureId,
      resultRef: entry.resultRef,
      resultSha256: resultArtifact.sha256,
      parseDisposition: result.parseDisposition
    });
    if (result.parseDisposition === "parsed") {
      parsedCount += 1;
      incrementCount(errorTypeCounts, result.feedbackRecords[0].primaryErrorType);
      incrementCount(severityCounts, result.feedbackRecords[0].severity);
    } else if (result.parseDisposition === "needs_human_label") {
      needsHumanLabelCount += 1;
      incrementCount(reasonCodeCounts, result.reasonCode);
    } else {
      throw new Error(`${entry.fixtureId} has unsupported parseDisposition.`);
    }
  }

  const totalSubmissions = resultBindings.length;
  return {
    schemaVersion: "1.0",
    kind: "teacher-feedback-diagnostic-report",
    reportId: `teacher-feedback-diagnostic-${inventoryArtifact.sha256.slice(0, 16)}`,
    fixtureSetId: inventory.fixtureSetId,
    sourceInventoryRef: path.basename(inventoryPath),
    sourceInventorySha256: inventoryArtifact.sha256,
    resultBindings,
    totals: {
      totalSubmissions,
      parsedCount,
      needsHumanLabelCount,
      structuredRate: roundRate(parsedCount, totalSubmissions),
      humanLabelRate: roundRate(needsHumanLabelCount, totalSubmissions)
    },
    errorTypeCounts,
    severityCounts,
    reasonCodeCounts,
    optimizationCandidateRefs: [],
    stopReason: "teacher_feedback_diagnostic_only_no_optimizer"
  };
}

function buildExpectedReplayReport(compileResult) {
  const authority = loadCanonicalTeacherFeedbackReplayAuthority();
  const replayBindings = authority.entries.map((entry) => {
    const replayedResult = compileResult({
      runPath: entry.sourceRunPath,
      feedbackPath: entry.submissionPath
    });
    assertSchema(
      `${entry.fixtureId} replayed FeedbackParseResult`,
      replayedResult,
      feedbackParseResultSchemaPath);
    const replayedBytes = serializeJson(replayedResult);
    const expectedBytes = fs.readFileSync(entry.expectedResultPath);
    return {
      fixtureId: entry.fixtureId,
      submissionRef: entry.submissionRef,
      submissionSha256: entry.submissionSha256,
      expectedResultRef: entry.expectedResultRef,
      expectedResultSha256: entry.expectedResultSha256,
      replayedResultSha256: sha256(replayedBytes),
      replayDisposition: replayedBytes.equals(expectedBytes) ? "passed" : "failed"
    };
  });
  const passedCount = replayBindings.filter(
    (binding) => binding.replayDisposition === "passed").length;
  const totalReplays = replayBindings.length;
  return {
    schemaVersion: "1.0",
    kind: "teacher-feedback-replay-diagnostic-report",
    reportId: `teacher-feedback-replay-${authority.inventorySha256.slice(0, 16)}`,
    fixtureSetId: authority.inventory.fixtureSetId,
    sourceInventoryRef: path.basename(authority.inventoryPath),
    sourceInventorySha256: authority.inventorySha256,
    replayBindings,
    totals: {
      totalReplays,
      passedCount,
      failedCount: totalReplays - passedCount,
      passRate: roundRate(passedCount, totalReplays)
    },
    optimizationCandidateRefs: [],
    stopReason: "teacher_feedback_replay_diagnostic_only_no_optimizer"
  };
}

function emptyCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

function incrementCount(counts, key) {
  if (!Object.hasOwn(counts, key)) {
    throw new Error(`Unsupported teacher feedback diagnostic category: ${key}`);
  }
  counts[key] += 1;
}

function roundRate(numerator, denominator) {
  return Number((numerator / denominator).toFixed(6));
}

function resolveFixtureRef(reference, label) {
  const value = requireText(reference, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative.`);
  }
  const resolvedPath = requireFile(path.resolve(fixtureRoot, value), label);
  if (!pathIsWithin(resolvedPath, fixtureRoot)) {
    throw new Error(`${label} escapes the canonical teacher fixture root.`);
  }
  return resolvedPath;
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = requireFile(path.resolve(filePath), label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
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
    throw new Error(
      `${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function protectedAuthorityPaths() {
  const authority = loadCanonicalTeacherFeedbackReplayAuthority();
  const paths = [authority.inventoryPath];
  for (const entry of authority.entries) {
    const submissionPath = entry.submissionPath;
    paths.push(submissionPath, entry.expectedResultPath, entry.sourceRunPath);
    const submission = readJsonArtifact(
      submissionPath,
      `${entry.fixtureId} TeacherFeedbackSubmission`).value;
    paths.push(...getCanonicalSampleAuthorityPaths(submission.sampleId));
  }
  return paths;
}

function assertOutputDoesNotAliasAuthority(outputPath) {
  const resolvedOutputPath = path.resolve(requireText(outputPath, "--out"));
  if (path.extname(resolvedOutputPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }
  if (pathIsWithin(resolvedOutputPath, fixtureRoot)) {
    throw new Error("--out must remain outside the canonical teacher fixture root.");
  }
  if (pathIsWithin(resolvedOutputPath, sampleRoot)) {
    throw new Error("--out must remain outside the canonical sample root.");
  }
  if (pathIsWithin(resolvedOutputPath, repoRoot)) {
    throw new Error("--out must remain outside the repository root.");
  }
  if (fs.existsSync(resolvedOutputPath)
    && fs.statSync(resolvedOutputPath, { bigint: true }).nlink > 1n) {
    throw new Error("--out must not be a hardlink alias.");
  }
  const outputCanonical = canonicalPath(resolvedOutputPath);
  const outputIdentity = fileIdentity(resolvedOutputPath);
  if (protectedAuthorityPaths().some((inputPath) =>
    outputCanonical === canonicalPath(inputPath)
    || sameFileIdentity(outputIdentity, fileIdentity(inputPath)))) {
    throw new Error("--out must not alias canonical teacher feedback authority.");
  }
}

function pathIsWithin(filePath, allowedRoot) {
  const relative = path.relative(normalizePath(allowedRoot), canonicalPath(filePath));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
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

function normalizePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
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

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const options = { reportKind: "ingestion" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.outPath = requireText(argv[++index], arg);
    } else if (arg === "--report") {
      options.reportKind = requireText(argv[++index], arg);
      if (!["ingestion", "replay"].includes(options.reportKind)) {
        throw new Error("--report must be ingestion or replay.");
      }
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
  const report = options.reportKind === "replay"
    ? compileTeacherFeedbackReplayDiagnosticReport()
    : compileTeacherFeedbackDiagnosticReport();
  assertOutputDoesNotAliasAuthority(options.outPath);
  atomicWriteJson(options.outPath, report);
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
