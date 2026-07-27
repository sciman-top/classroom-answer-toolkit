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
const submissionSchema = path.join(schemaRoot, "teacher-feedback-submission.schema.json");
const resultSchema = path.join(schemaRoot, "feedback-parse-result.schema.json");
const inventorySchema = path.join(
  schemaRoot,
  "teacher-feedback-fixture-inventory.schema.json");
const teacherFixtureRoot = fs.realpathSync.native(path.join(
  repoRoot,
  "eval",
  "sample-flywheel",
  "cases",
  "synthetic-teacher-feedback"));
const teacherFixtureInventoryPath = path.join(
  teacherFixtureRoot,
  "teacher-feedback-fixture-inventory.json");
const errorLexicon = new Map([
  ["spec_gap", ["规范缺口", "spec gap"]],
  ["rule_gap", ["规则缺口", "rule gap"]],
  ["routing_error", ["路由错误", "routing error"]],
  ["visual_error", ["读图错误", "visual error"]],
  ["ocr_error", ["ocr错误", "ocr error"]],
  ["reference_parse_error", ["参考答案解析错误", "reference parse error"]],
  ["reasoning_error", ["推理错误", "计算错误", "reasoning error"]],
  ["format_error", ["格式错误", "format error"]],
  ["data_quality_issue", ["数据质量问题", "data quality issue"]]
]);
const severityLexicon = new Map([
  ["low", ["低严重度", "low severity"]],
  ["medium", ["中严重度", "medium severity"]],
  ["high", ["高严重度", "high severity"]],
  ["critical", ["致命严重度", "critical severity"]]
]);
const sha256Pattern = /^[a-f0-9]{64}$/;

export function compileTeacherFeedbackParseResult(options = {}) {
  const context = readTeacherFeedbackContext(options.runPath, options.feedbackPath);
  const result = buildExpectedResult(context);
  validateTeacherFeedbackParseResult(result, context.runArtifact.path, context.feedbackArtifact.path);
  return result;
}

export function validateTeacherFeedbackSubmission(submission, submissionPath, sourceRunPath) {
  assertSchema("TeacherFeedbackSubmission", submission, submissionSchema);
  if (submission.schemaVersion !== "1.0") {
    throw new Error("TeacherFeedbackSubmission schemaVersion is unsupported.");
  }
  if (submission.fixtureKind !== "synthetic_fixture"
    || submission.dataClassification?.level !== "public"
    || submission.reporter !== "synthetic_teacher_fixture") {
    throw new Error(
      "TeacherFeedbackSubmission currently admits public synthetic fixtures only.");
  }
  const text = requireText(submission.text, "TeacherFeedbackSubmission text");
  if (text.length > 2000 || text.includes("\0")) {
    throw new Error("TeacherFeedbackSubmission text must be 1-2000 characters without NUL.");
  }
  requireCanonicalTimestamp(submission.createdAt, "TeacherFeedbackSubmission createdAt");
  assertSha256(submission.sourceRunSha256, "TeacherFeedbackSubmission sourceRunSha256");
  const referencedRunPath = resolveRelativeFile(
    submission.sourceRunRef,
    submissionPath,
    "TeacherFeedbackSubmission sourceRunRef");
  if (!sameCanonicalPath(referencedRunPath, sourceRunPath)) {
    throw new Error("TeacherFeedbackSubmission sourceRunRef does not match the selected run.");
  }
  return submission;
}

export function validateTeacherFeedbackParseResult(result, sourceRunPath, feedbackPath) {
  assertSchema("Teacher FeedbackParseResult", result, resultSchema);
  const context = readTeacherFeedbackContext(sourceRunPath, feedbackPath);
  const expected = buildExpectedResult(context);
  if (!isDeepStrictEqual(result, expected)) {
    throw new Error(
      "Teacher FeedbackParseResult does not match its source run and feedback bytes.");
  }
  if (!Array.isArray(result.optimizationCandidateRefs)
    || result.optimizationCandidateRefs.length !== 0) {
    throw new Error("Teacher FeedbackParseResult optimizationCandidateRefs must remain empty.");
  }
  return result;
}

export function validateCanonicalTeacherFeedbackFixtures() {
  const authority = loadCanonicalTeacherFeedbackReplayAuthority();
  for (const entry of authority.entries) {
    validateTeacherFeedbackParseResult(
      entry.expectedResult,
      entry.sourceRunPath,
      entry.submissionPath);
  }
  return authority.inventory;
}

export function loadCanonicalTeacherFeedbackReplayAuthority() {
  const inventoryArtifact = readJsonArtifact(
    teacherFixtureInventoryPath,
    "teacher feedback fixture inventory");
  const inventory = validateTeacherFixtureInventory(inventoryArtifact.value);
  const admittedSubmissions = new Set();
  const admittedResults = new Set();
  const entries = [];
  for (const entry of inventory.entries) {
    const submissionPath = resolveTeacherFixtureRef(
      entry.submissionRef,
      `${entry.fixtureId} submissionRef`);
    const resultPath = resolveTeacherFixtureRef(
      entry.resultRef,
      `${entry.fixtureId} resultRef`);
    const submissionArtifact = readJsonArtifact(
      submissionPath,
      `${entry.fixtureId} TeacherFeedbackSubmission`);
    const resultArtifact = readJsonArtifact(
      resultPath,
      `${entry.fixtureId} FeedbackParseResult`);
    if (submissionArtifact.sha256 !== entry.submissionSha256
      || resultArtifact.sha256 !== entry.resultSha256) {
      throw new Error(`${entry.fixtureId} teacher fixture bytes do not match inventory hashes.`);
    }
    assertSchema(
      `${entry.fixtureId} expected FeedbackParseResult`,
      resultArtifact.value,
      resultSchema);
    const runPath = resolveRelativeFile(
      submissionArtifact.value.sourceRunRef,
      submissionArtifact.path,
      `${entry.fixtureId} sourceRunRef`);
    admittedSubmissions.add(normalizePath(submissionArtifact.path));
    admittedResults.add(normalizePath(resultArtifact.path));
    entries.push({
      fixtureId: entry.fixtureId,
      submissionRef: entry.submissionRef,
      submissionPath: submissionArtifact.path,
      submissionSha256: submissionArtifact.sha256,
      sourceRunPath: runPath,
      expectedResultRef: entry.resultRef,
      expectedResultPath: resultArtifact.path,
      expectedResultSha256: resultArtifact.sha256,
      expectedResult: resultArtifact.value
    });
  }
  assertExactFixtureCoverage(
    admittedSubmissions,
    ".teacher-feedback-submission.json",
    "submission");
  assertExactFixtureCoverage(
    admittedResults,
    ".feedback-parse-result.json",
    "result");
  return {
    inventory,
    inventoryPath: inventoryArtifact.path,
    inventorySha256: inventoryArtifact.sha256,
    entries
  };
}

function readTeacherFeedbackContext(runPath, feedbackPath) {
  const runArtifact = readJsonArtifact(runPath, "source SampleRunRecord");
  validateSampleRunRecord(runArtifact.value);
  if (runArtifact.value.runMode !== "scoring"
    || runArtifact.value.diffSummary?.exactMatch !== false
    || runArtifact.value.rootCauseSummary?.detected !== true) {
    throw new Error("teacher feedback parsing requires a detected non-exact scoring run.");
  }
  const feedbackArtifact = readJsonArtifact(
    feedbackPath,
    "TeacherFeedbackSubmission");
  validateTeacherFixtureAuthority(feedbackArtifact);
  validateTeacherFeedbackSubmission(
    feedbackArtifact.value,
    feedbackArtifact.path,
    runArtifact.path);
  if (feedbackArtifact.value.sourceRunSha256 !== runArtifact.sha256) {
    throw new Error("TeacherFeedbackSubmission sourceRunSha256 does not match run bytes.");
  }
  for (const [field, expected] of [
    ["sampleId", runArtifact.value.sampleId],
    ["subjectPack", runArtifact.value.subjectPack]
  ]) {
    if (feedbackArtifact.value[field] !== expected) {
      throw new Error(`TeacherFeedbackSubmission ${field} does not match source run.`);
    }
  }
  return { runArtifact, feedbackArtifact };
}

function buildExpectedResult(context) {
  const { runArtifact, feedbackArtifact } = context;
  const run = runArtifact.value;
  const submission = feedbackArtifact.value;
  const signals = classifyTeacherText(submission.text);
  const base = {
    schemaVersion: "2.0",
    kind: "feedback-parse-result",
    sampleId: run.sampleId,
    subjectPack: run.subjectPack,
    parseMode: "teacher_text_lexicon",
    sourceRunSha256: runArtifact.sha256,
    sampleIndexSha256: run.sampleIndexSha256,
    samplePackageSha256: run.samplePackageSha256,
    candidateDescriptorSha256: run.candidateDescriptorSha256,
    sourceFeedbackId: submission.submissionId,
    sourceFeedbackSha256: feedbackArtifact.sha256,
    optimizationCandidateRefs: []
  };
  if (signals.reasonCode !== undefined) {
    return {
      ...base,
      parseDisposition: "needs_human_label",
      humanQueue: "needs_human_label",
      reasonCode: signals.reasonCode,
      feedbackRecords: [],
      stopReason: "feedback_needs_human_label_no_optimizer"
    };
  }

  const feedbackRecord = {
    schemaVersion: "1.0",
    kind: "feedback-record",
    feedbackId: `teacher-feedback-${feedbackArtifact.sha256.slice(0, 16)}`,
    subjectPack: run.subjectPack,
    source: "teacher_input",
    primaryErrorType: signals.errorTypes[0],
    contributingErrorTypes: [],
    confidence: 0.9,
    severity: signals.severities[0],
    evidence: {
      method: "teacher_text_lexicon_v1",
      sourceFeedbackSha256: feedbackArtifact.sha256,
      sourceRunSha256: runArtifact.sha256,
      matchedErrorTypes: signals.errorTypes,
      matchedSeverities: signals.severities
    },
    reproInput: {
      sampleId: run.sampleId,
      iteration: run.iteration,
      candidateArtifactRef: run.candidateArtifactRef
    },
    reporter: submission.reporter,
    status: "parsed",
    firstObservedIteration: run.iteration,
    createdAt: submission.createdAt
  };
  return {
    ...base,
    parseDisposition: "parsed",
    feedbackRecords: [feedbackRecord],
    stopReason: "feedback_recorded_no_optimizer"
  };
}

export function classifyTeacherText(text) {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("en-US");
  const errorTypes = matchLexicon(normalized, errorLexicon);
  const severities = matchLexicon(normalized, severityLexicon);
  let reasonCode;
  if (hasNegatedErrorSignal(normalized)) {
    reasonCode = "negated_error_signal";
  } else if (errorTypes.length === 0) {
    reasonCode = "missing_error_signal";
  } else if (errorTypes.length > 1) {
    reasonCode = "ambiguous_error_signal";
  } else if (severities.length === 0) {
    reasonCode = "missing_severity_signal";
  } else if (severities.length > 1) {
    reasonCode = "ambiguous_severity_signal";
  }
  return { errorTypes, severities, reasonCode };
}

function hasNegatedErrorSignal(text) {
  return [...errorLexicon.values()].flat().some((phrase) => [
    `没有${phrase}`,
    `不是${phrase}`,
    `无${phrase}`,
    `not a ${phrase}`,
    `not an ${phrase}`,
    `no ${phrase}`
  ].some((negated) => text.includes(negated)));
}

function matchLexicon(text, lexicon) {
  return [...lexicon.entries()]
    .filter(([, phrases]) => phrases.some((phrase) => text.includes(phrase)))
    .map(([value]) => value);
}

function readTeacherFixtureInventory() {
  return validateTeacherFixtureInventory(readJsonArtifact(
    teacherFixtureInventoryPath,
    "teacher feedback fixture inventory").value);
}

function validateTeacherFixtureInventory(inventory) {
  assertSchema("TeacherFeedbackFixtureInventory", inventory, inventorySchema);
  if (inventory.schemaVersion !== "1.0"
    || inventory.kind !== "teacher-feedback-fixture-inventory") {
    throw new Error("TeacherFeedbackFixtureInventory version or kind is unsupported.");
  }
  const fixtureIds = inventory.entries.map((entry) => entry.fixtureId);
  const submissionRefs = inventory.entries.map((entry) => entry.submissionRef);
  const resultRefs = inventory.entries.map((entry) => entry.resultRef);
  if (new Set(fixtureIds).size !== fixtureIds.length
    || new Set(submissionRefs).size !== submissionRefs.length
    || new Set(resultRefs).size !== resultRefs.length) {
    throw new Error("TeacherFeedbackFixtureInventory entries must have unique IDs and refs.");
  }
  return inventory;
}

function validateTeacherFixtureAuthority(feedbackArtifact) {
  const inventory = readTeacherFixtureInventory();
  const match = inventory.entries.find((entry) => {
    const submissionPath = resolveTeacherFixtureRef(
      entry.submissionRef,
      `${entry.fixtureId} submissionRef`);
    return sameCanonicalPath(submissionPath, feedbackArtifact.path);
  });
  if (!match || match.submissionSha256 !== feedbackArtifact.sha256) {
    throw new Error(
      "TeacherFeedbackSubmission is not admitted by canonical fixture authority.");
  }
}

function resolveTeacherFixtureRef(reference, label) {
  const value = requireText(reference, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative.`);
  }
  const resolved = requireFile(path.resolve(teacherFixtureRoot, value), label);
  if (!pathIsWithin(resolved, teacherFixtureRoot)) {
    throw new Error(`${label} escapes the canonical teacher fixture root.`);
  }
  return resolved;
}

function assertExactFixtureCoverage(admittedPaths, suffix, label) {
  const actualPaths = new Set(
    listFilesBySuffixRecursive(teacherFixtureRoot, suffix).map(normalizePath));
  if (actualPaths.size !== admittedPaths.size
    || [...actualPaths].some((filePath) => !admittedPaths.has(filePath))) {
    throw new Error(
      `Canonical teacher fixture ${label} files must exactly match inventory entries.`);
  }
}

function listFilesBySuffixRecursive(directoryPath, suffix) {
  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listFilesBySuffixRecursive(entryPath, suffix);
    }
    return entry.isFile() && entry.name.endsWith(suffix) ? [entryPath] : [];
  });
}

function resolveRelativeFile(reference, ownerPath, label) {
  const value = requireText(reference, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative.`);
  }
  return requireFile(path.resolve(path.dirname(ownerPath), value), label);
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = requireFile(path.resolve(requireText(filePath, label)), label);
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

function sameCanonicalPath(left, right) {
  return normalizePath(fs.realpathSync.native(left))
    === normalizePath(fs.realpathSync.native(right));
}

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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

function assertOutputDoesNotAliasInputs(outputPath, runPath, feedbackPath, sampleId) {
  const resolvedOutputPath = path.resolve(requireText(outputPath, "--out"));
  if (path.extname(resolvedOutputPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }
  if (pathIsWithin(resolvedOutputPath, teacherFixtureRoot)) {
    throw new Error("--out must remain outside the canonical teacher fixture root.");
  }
  if (pathIsWithin(resolvedOutputPath, sampleRoot)) {
    throw new Error("--out must remain outside the canonical sample root.");
  }
  const protectedInputs = [
    requireFile(path.resolve(runPath), "source SampleRunRecord"),
    requireFile(path.resolve(feedbackPath), "TeacherFeedbackSubmission"),
    ...getCanonicalSampleAuthorityPaths(sampleId)
  ];
  const outputCanonical = canonicalPath(resolvedOutputPath);
  const outputIdentity = fileIdentity(resolvedOutputPath);
  if (protectedInputs.some((inputPath) =>
    outputCanonical === canonicalPath(inputPath)
    || sameFileIdentity(outputIdentity, fileIdentity(inputPath)))) {
    throw new Error("--out must not alias source feedback, source run, or canonical authority.");
  }
}

function pathIsWithin(filePath, allowedRoot) {
  const relative = path.relative(
    normalizePath(fs.realpathSync.native(allowedRoot)),
    canonicalPath(filePath));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueFlags = {
      "--run": "runPath",
      "--feedback": "feedbackPath",
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
  const result = compileTeacherFeedbackParseResult(options);
  assertOutputDoesNotAliasInputs(
    options.outPath,
    options.runPath,
    options.feedbackPath,
    result.sampleId);
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
