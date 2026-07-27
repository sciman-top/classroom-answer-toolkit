import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { compileDecisionRecord, validateDecisionRecord } from "./decision-record.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const canonicalFixtureRoot = fs.realpathSync.native(path.join(
  repoRoot,
  "eval",
  "visual-evidence",
  "cases",
  "visual-risk"));
const subjectPacks = [
  "math-answer",
  "junior-physics-answer",
  "senior-physics-answer"
];
const schemaPaths = {
  inventory: path.join(schemaRoot, "visual-risk-case-inventory.schema.json"),
  report: path.join(schemaRoot, "visual-risk-diagnostic-report.schema.json"),
  evidence: path.join(schemaRoot, "problem-evidence-bundle.schema.json"),
  track: path.join(schemaRoot, "track-result.schema.json"),
  decision: path.join(schemaRoot, "decision-record.schema.json")
};

export function validateCanonicalVisualRiskFixtures(options = {}) {
  const fixtureRoot = resolveFixtureRoot(options.fixtureRoot);
  const inventoryPath = resolveFixtureRef(
    fixtureRoot,
    "visual-risk-case-inventory.json",
    "visual risk case inventory");
  const inventoryArtifact = readJsonArtifact(inventoryPath, "visual risk case inventory");
  assertSchema("VisualRiskCaseInventory", inventoryArtifact.value, schemaPaths.inventory);
  const inventory = inventoryArtifact.value;
  assertInventoryShape(inventory);

  const referencedPaths = new Set();
  const referencedIdentities = new Set();
  const caseAuthorities = inventory.entries.map((entry) => {
    const evidenceArtifact = loadBoundArtifact(
      fixtureRoot,
      entry.evidenceBundleRef,
      entry.evidenceBundleSha256,
      `${entry.caseId} evidence bundle`,
      schemaPaths.evidence,
      referencedPaths,
      referencedIdentities);
    const trackArtifacts = entry.trackResultBindings.map((binding) => loadBoundArtifact(
      fixtureRoot,
      binding.trackResultRef,
      binding.trackResultSha256,
      `${entry.caseId} ${binding.trackType} track result`,
      schemaPaths.track,
      referencedPaths,
      referencedIdentities));
    const expectedDecisionArtifact = loadBoundArtifact(
      fixtureRoot,
      entry.expectedDecisionRef,
      entry.expectedDecisionSha256,
      `${entry.caseId} expected decision`,
      schemaPaths.decision,
      referencedPaths,
      referencedIdentities);
    assertCaseAuthority(entry, evidenceArtifact.value, trackArtifacts.map((item) => item.value), expectedDecisionArtifact.value);
    return {
      entry,
      evidenceArtifact,
      trackArtifacts,
      expectedDecisionArtifact
    };
  });

  assertExactAuthorityCoverage(fixtureRoot, referencedPaths);
  return {
    fixtureRoot,
    inventoryPath,
    inventorySha256: inventoryArtifact.sha256,
    inventory,
    caseAuthorities
  };
}

export function compileVisualRiskDiagnosticReport(options = {}) {
  const authority = validateCanonicalVisualRiskFixtures(options);
  const compileDecision = options.compileDecision ?? compileDecisionRecord;
  if (typeof compileDecision !== "function") {
    throw new Error("Visual risk compileDecision must be a function.");
  }

  const caseBindings = authority.caseAuthorities.map((item) => {
    const replayedDecision = compileDecision({
      evidenceBundle: item.evidenceArtifact.value,
      trackResults: item.trackArtifacts.map((artifact) => artifact.value),
      generatedAt: item.entry.decisionGeneratedAt
    });
    const decisionErrors = validateDecisionRecord(replayedDecision);
    if (decisionErrors.length > 0) {
      throw new Error(`${item.entry.caseId} replayed DecisionRecord schema validation failed:\n${formatErrors(decisionErrors)}`);
    }
    const replayedBytes = serializeJson(replayedDecision);
    const expectedBytes = item.expectedDecisionArtifact.bytes;
    const ocrImageConflictDetected = replayedDecision.decisionReasons.includes("ocr_image_conflict");
    if (ocrImageConflictDetected !== item.entry.expectedOcrImageConflict) {
      throw new Error(
        `${item.entry.caseId} OCR/image conflict result does not match inventory expectation.`);
    }
    const correctlyFlagged = item.entry.expectedReview
      && replayedDecision.reviewRequired === true
      && replayedDecision.trusted === false;
    return {
      caseId: item.entry.caseId,
      subjectPack: item.entry.subjectPack,
      evidenceBundleSha256: item.evidenceArtifact.sha256,
      trackResultSha256s: item.trackArtifacts.map((artifact) => artifact.sha256),
      expectedDecisionSha256: item.expectedDecisionArtifact.sha256,
      replayedDecisionSha256: sha256(replayedBytes),
      replayDisposition: replayedBytes.equals(expectedBytes) ? "passed" : "failed",
      falseReleased: item.entry.expectedReview
        && (replayedDecision.decision === "accept" || replayedDecision.trusted === true),
      correctlyFlagged,
      bindingCorrect: bindingMatches(item.entry.expectedBinding, item.evidenceArtifact.value),
      ocrImageConflictDetected
    };
  });

  const report = {
    schemaVersion: "1.0",
    kind: "visual-risk-diagnostic-report",
    reportId: `visual-risk-diagnostic-${authority.inventorySha256.slice(0, 16)}`,
    fixtureSetId: authority.inventory.fixtureSetId,
    sourceInventoryRef: path.basename(authority.inventoryPath),
    sourceInventorySha256: authority.inventorySha256,
    caseBindings,
    subjectReports: subjectPacks.map((subjectPack) => buildMetricReport(
      subjectPack,
      caseBindings.filter((binding) => binding.subjectPack === subjectPack))),
    totals: buildMetricReport("all-subject-packs", caseBindings),
    readinessBoundary: {
      toolchainControl: "not_verified",
      restrictedEgressControl: "not_verified",
      eligible: false
    },
    optimizationCandidateRefs: [],
    stopReason: "synthetic_visual_risk_diagnostic_only_no_optimizer"
  };
  assertSchema("VisualRiskDiagnosticReport", report, schemaPaths.report);
  return report;
}

export function validateVisualRiskDiagnosticReport(report) {
  assertSchema("VisualRiskDiagnosticReport", report, schemaPaths.report);
  const expected = compileVisualRiskDiagnosticReport();
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error("VisualRiskDiagnosticReport does not match canonical visual-risk authority bytes.");
  }
  return report;
}

function assertInventoryShape(inventory) {
  if (inventory.entries.length !== 6) {
    throw new Error("Visual risk inventory must contain exactly 6 canonical cases.");
  }
  const caseIds = new Set();
  for (const entry of inventory.entries) {
    if (caseIds.has(entry.caseId)) {
      throw new Error(`Duplicate visual risk caseId: ${entry.caseId}`);
    }
    caseIds.add(entry.caseId);
    const trackTypes = entry.trackResultBindings.map((binding) => binding.trackType);
    if (new Set(trackTypes).size !== trackTypes.length) {
      throw new Error(`${entry.caseId} contains duplicate track types.`);
    }
  }
  for (const subjectPack of subjectPacks) {
    const count = inventory.entries.filter((entry) => entry.subjectPack === subjectPack).length;
    if (count !== 2) {
      throw new Error(`${subjectPack} must contribute exactly 2 visual risk cases.`);
    }
  }
}

function assertCaseAuthority(entry, evidenceBundle, trackResults, expectedDecision) {
  if (evidenceBundle.subjectPack !== entry.subjectPack) {
    throw new Error(`${entry.caseId} evidence subjectPack does not match inventory.`);
  }
  if (evidenceBundle.provenance?.sourceType !== "synthetic_fixture"
    || evidenceBundle.provenance?.egressPolicy?.allowCloud !== false) {
    throw new Error(`${entry.caseId} evidence must remain synthetic_fixture with cloud egress disabled.`);
  }
  for (let index = 0; index < trackResults.length; index += 1) {
    const track = trackResults[index];
    const binding = entry.trackResultBindings[index];
    if (track.evidenceBundleRef !== evidenceBundle.evidenceBundleId
      || track.trackType !== binding.trackType
      || track.candidateSourceType !== "reference_placeholder") {
      throw new Error(`${entry.caseId} track authority does not match inventory/evidence synthetic boundary.`);
    }
  }
  if (expectedDecision.subjectPack !== entry.subjectPack
    || expectedDecision.evidenceBundleRef !== evidenceBundle.evidenceBundleId
    || !isDeepStrictEqual(
      expectedDecision.trackResultRefs,
      trackResults.map((track) => track.trackResultId))) {
    throw new Error(`${entry.caseId} expected decision authority is not bound to its evidence/tracks.`);
  }
}

function loadBoundArtifact(
  fixtureRoot,
  reference,
  expectedSha256,
  label,
  schemaPath,
  referencedPaths,
  referencedIdentities) {
  const artifactPath = resolveFixtureRef(fixtureRoot, reference, label);
  if (referencedPaths.has(artifactPath)) {
    throw new Error(`${label} is referenced more than once.`);
  }
  const identity = fileIdentity(artifactPath);
  if (referencedIdentities.has(identity)) {
    throw new Error(`${label} aliases another visual risk authority file by physical identity.`);
  }
  referencedPaths.add(artifactPath);
  referencedIdentities.add(identity);
  const artifact = readJsonArtifact(artifactPath, label);
  if (artifact.sha256 !== expectedSha256) {
    throw new Error(`${label} bytes do not match inventory hash.`);
  }
  assertSchema(label, artifact.value, schemaPath);
  return artifact;
}

function assertExactAuthorityCoverage(fixtureRoot, referencedPaths) {
  const authorityFiles = listAuthorityFilesRecursive(fixtureRoot);
  if (authorityFiles.length !== referencedPaths.size
    || authorityFiles.some((filePath) => !referencedPaths.has(filePath))) {
    throw new Error("Visual risk inventory must exactly cover canonical evidence, track, and decision authority files.");
  }
}

function listAuthorityFilesRecursive(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      const targetStat = fs.statSync(entryPath);
      if (targetStat.isDirectory()) {
        throw new Error("Visual risk fixture directories must not be symlink or junction aliases.");
      }
      if (targetStat.isFile() && isAuthorityFileName(entry.name)) {
        results.push(fs.realpathSync.native(entryPath));
      }
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...listAuthorityFilesRecursive(entryPath));
    } else if (entry.isFile() && isAuthorityFileName(entry.name)) {
      results.push(fs.realpathSync.native(entryPath));
    }
  }
  return results;
}

function isAuthorityFileName(name) {
  return name.endsWith(".problem-evidence-bundle.json")
    || /\.track-[abc]\.json$/.test(name)
    || name.endsWith(".decision-record.json");
}

function fileIdentity(filePath) {
  const stat = fs.statSync(filePath, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}

function bindingMatches(expected, evidenceBundle) {
  return evidenceBundle.binding?.status === expected.status
    && evidenceBundle.questionRef === expected.questionRef
    && isDeepStrictEqual(evidenceBundle.figureRefs, expected.figureRefs)
    && isDeepStrictEqual(evidenceBundle.cropRefs, expected.cropRefs)
    && isDeepStrictEqual(evidenceBundle.evidenceRefs, expected.evidenceRefs);
}

function buildMetricReport(subjectPack, bindings) {
  if (bindings.length === 0) {
    throw new Error(`${subjectPack} visual risk metric denominator must not be empty.`);
  }
  const expectedReviewCount = bindings.length;
  const falseReleaseCount = count(bindings, (binding) => binding.falseReleased);
  const correctlyFlaggedCount = count(bindings, (binding) => binding.correctlyFlagged);
  const bindingCorrectCount = count(bindings, (binding) => binding.bindingCorrect);
  const replayPassedCount = count(bindings, (binding) => binding.replayDisposition === "passed");
  return {
    subjectPack,
    totalCases: bindings.length,
    expectedReviewCount,
    falseReleaseCount,
    falseReleaseRate: roundRate(falseReleaseCount, expectedReviewCount),
    correctlyFlaggedCount,
    correctFlagRecall: roundRate(correctlyFlaggedCount, expectedReviewCount),
    bindingCorrectCount,
    bindingAccuracy: roundRate(bindingCorrectCount, bindings.length),
    replayPassedCount,
    replayPassRate: roundRate(replayPassedCount, bindings.length)
  };
}

function count(values, predicate) {
  return values.filter(predicate).length;
}

function roundRate(numerator, denominator) {
  return Number((numerator / denominator).toFixed(6));
}

function resolveFixtureRoot(value) {
  if (!value) {
    return canonicalFixtureRoot;
  }
  const resolvedPath = path.resolve(value);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Visual risk fixture root not found: ${resolvedPath}`);
  }
  return fs.realpathSync.native(resolvedPath);
}

function resolveFixtureRef(fixtureRoot, reference, label) {
  if (typeof reference !== "string" || reference.length === 0 || path.isAbsolute(reference)) {
    throw new Error(`${label} reference must be a non-empty relative path.`);
  }
  const resolvedPath = path.resolve(fixtureRoot, reference);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`${label} not found: ${resolvedPath}`);
  }
  const canonicalPath = fs.realpathSync.native(resolvedPath);
  if (!pathIsWithin(canonicalPath, fixtureRoot)) {
    throw new Error(`${label} escapes the visual risk fixture root.`);
  }
  return canonicalPath;
}

function readJsonArtifact(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  const resolvedPath = fs.realpathSync.native(filePath);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${formatErrors(errors)}`);
  }
}

function formatErrors(errors) {
  return errors.map((error) => `- ${error}`).join("\n");
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pathIsWithin(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafeOutputPath(outputPath) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new Error("--out is required.");
  }
  const resolvedPath = path.resolve(outputPath);
  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error("--out must point to a JSON file.");
  }
  if (pathIsWithin(canonicalizeMissingPath(resolvedPath), fs.realpathSync.native(repoRoot))) {
    throw new Error("--out must remain outside the repository root.");
  }
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath, { bigint: true }).nlink > 1n) {
    throw new Error("--out must not be a hardlink alias.");
  }
  return resolvedPath;
}

function canonicalizeMissingPath(filePath) {
  let existingPath = path.resolve(filePath);
  const missingParts = [];
  while (!fs.existsSync(existingPath)) {
    missingParts.unshift(path.basename(existingPath));
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      break;
    }
    existingPath = parent;
  }
  return path.join(fs.realpathSync.native(existingPath), ...missingParts);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, serializeJson(value), { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return null;
  }
  if (argv.length !== 2 || argv[0] !== "--out") {
    throw new Error("Usage: node visual-risk-diagnostic.mjs --out <repository-external-report.json>");
  }
  return { outPath: argv[1] };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const outputPath = assertSafeOutputPath(options.outPath);
  atomicWriteJson(outputPath, compileVisualRiskDiagnosticReport());
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
