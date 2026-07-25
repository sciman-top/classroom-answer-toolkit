import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { validateDeliveryManifest } from "../latex-renderer/validate-delivery-manifest.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const schemaRoot = path.join(repoRoot, "prompts", "shared", "schemas");
const coverageSchemaPath = path.join(schemaRoot, "delivery-question-coverage.schema.json");
const aggregateSchemaPath = path.join(schemaRoot, "delivery-decision-aggregate.schema.json");
const decisionRecordSchemaPath = path.join(schemaRoot, "decision-record.schema.json");
const deliveryManifestSchemaPath = path.join(schemaRoot, "delivery-manifest.schema.json");
const samplePackageSchemaPath = path.join(schemaRoot, "sample-package.schema.json");
const snapshotSchemaPath = path.join(schemaRoot, "snapshot.schema.json");
const acceptedDecisionReasons = new Set([
  "evidence_chain_complete",
  "dual_track_match",
  "human_approved"
]);

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/visual-evidence run compile:aggregate -- \\",
    "    --manifest <delivery-manifest.json> \\",
    "    --coverage <delivery-question-coverage.json> \\",
    "    --decision <decision-record.json> [--decision <decision-record.json> ...] \\",
    "    [--out <delivery-decision-aggregate.json>] [--generated-at <ISO-8601>]",
    "",
    "The compiler validates byte-level delivery bindings and exact question coverage.",
    "It does not modify the delivery manifest or advance review lifecycle."
  ].join("\n");
}

export function compileDeliveryDecisionAggregate(options) {
  const manifestArtifact = loadJsonArtifact(options.manifestPath, "delivery manifest");
  const coverageArtifact = loadJsonArtifact(options.coveragePath, "delivery question coverage");
  const decisionArtifacts = (options.decisionPaths ?? [])
    .map((decisionPath) => loadJsonArtifact(decisionPath, "DecisionRecord"));

  assertSchema("delivery manifest", manifestArtifact.value, deliveryManifestSchemaPath);
  const manifestSemanticErrors = validateDeliveryManifest(
    manifestArtifact.value,
    manifestArtifact.path,
    deliveryManifestSchemaPath);
  if (manifestSemanticErrors.length > 0) {
    throw new Error(
      `delivery manifest semantic validation failed:\n${manifestSemanticErrors.map((error) => `- ${error}`).join("\n")}`);
  }
  assertSchema("delivery question coverage", coverageArtifact.value, coverageSchemaPath);
  for (const artifact of decisionArtifacts) {
    assertSchema("DecisionRecord", artifact.value, decisionRecordSchemaPath);
  }

  const context = validateCoverageBinding(manifestArtifact, coverageArtifact);
  const decisionEntries = validateDecisionRecords(
    decisionArtifacts,
    coverageArtifact.value,
    context.binding);
  const expectedQuestionRefs = context.expectedQuestionRefs;
  const decisionByQuestionRef = new Map(
    decisionEntries.map((entry) => [entry.questionRef, entry])
  );
  const unresolvedQuestionRefs = expectedQuestionRefs.filter((questionRef) => {
    const entry = decisionByQuestionRef.get(questionRef);
    return !entry || !isAcceptedDecision(entry.decisionRecord, context.binding);
  });
  const acceptedCount = expectedQuestionRefs.length - unresolvedQuestionRefs.length;
  const manifestGatesPassed = ["toolchainPassed", "deliveryComplete", "reviewArtifactReady"]
    .every((field) => manifestArtifact.value.status?.[field] === true);
  const lifecycleState = manifestArtifact.value.review?.lifecycle?.state;
  const lifecycleApproved = ["approved", "published"].includes(lifecycleState);
  const trusted = coverageArtifact.value.coverageComplete === true
    && unresolvedQuestionRefs.length === 0
    && acceptedCount === expectedQuestionRefs.length
    && manifestGatesPassed
    && lifecycleApproved;
  const rejected = decisionEntries.some((entry) => entry.decisionRecord.decision === "reject");
  const decision = trusted ? "accept" : rejected ? "reject" : "review_required";
  const visualReviewPassed = trusted ? true : null;
  const referenceBasePath = path.dirname(path.resolve(
    options.outputPath ?? coverageArtifact.path
  ));

  const aggregate = {
    schemaVersion: "1.0",
    kind: "delivery-decision-aggregate",
    aggregateId: buildAggregateId({
      binding: context.binding,
      coverageSha256: coverageArtifact.sha256,
      decisionEntries
    }),
    subjectPack: manifestArtifact.value.subjectPack,
    deliveryBinding: context.binding,
    coverageRef: toReference(coverageArtifact.path, referenceBasePath),
    coverageSha256: coverageArtifact.sha256,
    decisionRecords: decisionEntries.map((entry) => ({
      questionRef: entry.questionRef,
      decisionRecordRef: toReference(entry.artifact.path, referenceBasePath),
      decisionRecordSha256: entry.artifact.sha256
    })),
    summary: {
      expectedCount: expectedQuestionRefs.length,
      decidedCount: decisionEntries.length,
      acceptedCount,
      unresolvedCount: unresolvedQuestionRefs.length,
      unresolvedQuestionRefs
    },
    decision,
    trusted,
    visualReviewPassed,
    reviewRequired: !trusted,
    reviewQueue: trusted ? "none" : "high_risk_approval",
    decisionReasons: [
      "delivery_binding_verified",
      coverageArtifact.value.coverageComplete ? "coverage_complete" : "coverage_incomplete",
      unresolvedQuestionRefs.length === 0 ? "all_questions_accepted" : "unresolved_questions",
      manifestGatesPassed ? "manifest_gates_passed" : "manifest_gates_failed",
      lifecycleApproved ? "review_lifecycle_approved" : "review_lifecycle_not_approved"
    ],
    statusProjection: {
      visualReviewPassed,
      trusted
    },
    generatedAt: options.generatedAt ?? new Date().toISOString()
  };

  const errors = validateDeliveryDecisionAggregateShape(aggregate);
  if (errors.length > 0) {
    throw new Error(`DeliveryDecisionAggregate validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return aggregate;
}

export function validateDeliveryDecisionAggregateShape(aggregate) {
  const errors = validateValueAgainstSchema(aggregate, aggregateSchemaPath);
  const summary = aggregate?.summary;
  if (!summary || typeof summary !== "object") {
    return errors;
  }

  const decisionRecords = Array.isArray(aggregate.decisionRecords)
    ? aggregate.decisionRecords
    : [];
  if (summary.decidedCount !== decisionRecords.length) {
    errors.push("summary.decidedCount must match decisionRecords length.");
  }
  if (summary.unresolvedCount !== summary.unresolvedQuestionRefs?.length) {
    errors.push("summary.unresolvedCount must match unresolvedQuestionRefs length.");
  }
  if (summary.acceptedCount + summary.unresolvedCount !== summary.expectedCount) {
    errors.push("summary accepted and unresolved counts must equal expectedCount.");
  }
  if (aggregate.statusProjection?.trusted !== aggregate.trusted
    || aggregate.statusProjection?.visualReviewPassed !== aggregate.visualReviewPassed) {
    errors.push("statusProjection must match aggregate trust fields.");
  }
  if (aggregate.trusted === true) {
    if (aggregate.decision !== "accept"
      || aggregate.visualReviewPassed !== true
      || aggregate.reviewRequired !== false
      || aggregate.reviewQueue !== "none"
      || summary.expectedCount <= 0
      || summary.decidedCount !== summary.expectedCount
      || decisionRecords.length !== summary.expectedCount
      || summary.unresolvedCount !== 0
      || summary.acceptedCount !== summary.expectedCount) {
      errors.push("trusted aggregate requires complete accepted coverage with no pending review.");
    }
  }
  if (!isSha256(aggregate.coverageSha256)) {
    errors.push("coverageSha256 must be a lowercase SHA-256 digest.");
  }
  for (const entry of decisionRecords) {
    if (!isSha256(entry.decisionRecordSha256)) {
      errors.push(`DecisionRecord ${JSON.stringify(entry.questionRef)} has an invalid SHA-256 digest.`);
    }
  }
  errors.push(...validateBindingShape(aggregate.deliveryBinding, "deliveryBinding"));
  return errors;
}

export function verifyDeliveryDecisionAggregate(options) {
  const aggregateArtifact = loadJsonArtifact(options.aggregatePath, "DeliveryDecisionAggregate");
  const aggregate = aggregateArtifact.value;
  const shapeErrors = validateDeliveryDecisionAggregateShape(aggregate);
  if (shapeErrors.length > 0) {
    throw new Error(
      `DeliveryDecisionAggregate shape validation failed:\n${shapeErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  const aggregateDir = path.dirname(aggregateArtifact.path);
  const coveragePath = options.coveragePath
    ? path.resolve(options.coveragePath)
    : resolveArtifactReference(aggregate.coverageRef, aggregateArtifact.path, "coverageRef");
  const decisionPaths = options.decisionPaths?.length > 0
    ? options.decisionPaths.map((decisionPath) => path.resolve(decisionPath))
    : aggregate.decisionRecords.map((entry) =>
      resolveArtifactReference(entry.decisionRecordRef, aggregateArtifact.path, "decisionRecordRef"));
  const coverageArtifact = loadJsonArtifact(coveragePath, "delivery question coverage");
  if (coverageArtifact.sha256 !== aggregate.coverageSha256) {
    throw new Error("coverageSha256 does not match referenced coverage bytes.");
  }
  const manifestPath = options.manifestPath
    ? path.resolve(options.manifestPath)
    : resolveManifestPathFromCoverage(coverageArtifact);
  const expected = compileDeliveryDecisionAggregate({
    manifestPath,
    coveragePath,
    decisionPaths,
    outputPath: aggregateArtifact.path,
    generatedAt: aggregate.generatedAt
  });
  if (!isDeepStrictEqual(
    projectAggregateContract(expected),
    projectAggregateContract(aggregate))) {
    throw new Error("DeliveryDecisionAggregate does not match recomputed source artifacts.");
  }
  return {
    valid: true,
    aggregate,
    sourceHashes: {
      aggregateSha256: aggregateArtifact.sha256,
      coverageSha256: coverageArtifact.sha256,
      decisionRecordSha256: decisionPaths.map((decisionPath) => sha256File(decisionPath))
    }
  };
}

function validateCoverageBinding(manifestArtifact, coverageArtifact) {
  const manifest = manifestArtifact.value;
  const coverage = coverageArtifact.value;
  const binding = coverage.deliveryBinding;
  const bindingErrors = validateBindingShape(binding, "deliveryBinding");
  if (bindingErrors.length > 0) {
    throw new Error(bindingErrors.join("\n"));
  }
  if (coverage.subjectPack !== manifest.subjectPack) {
    throw new Error("Coverage subjectPack does not match delivery manifest.");
  }
  if (binding.manifestSha256 !== manifestArtifact.sha256) {
    throw new Error("Coverage manifestSha256 does not match delivery manifest bytes.");
  }

  const snapshotId = manifest.snapshot?.id;
  if (!snapshotId || binding.snapshotId !== snapshotId) {
    throw new Error("Coverage snapshotId does not match delivery manifest snapshot.id.");
  }
  const snapshotPath = resolveArtifactReference(manifest.snapshotPath, manifestArtifact.path, "snapshotPath");
  const inputPath = resolveArtifactReference(manifest.input, manifestArtifact.path, "input");
  const snapshotArtifact = loadJsonArtifact(snapshotPath, "resolved snapshot");
  assertSchema("resolved snapshot", snapshotArtifact.value, snapshotSchemaPath);
  if (snapshotArtifact.sha256 !== binding.snapshotSha256) {
    throw new Error("Coverage snapshotSha256 does not match snapshot bytes.");
  }
  if (snapshotArtifact.value.snapshotId !== binding.snapshotId
    || snapshotArtifact.value.subjectPack?.assetId !== manifest.subjectPack) {
    throw new Error("Resolved snapshot identity does not match delivery binding.");
  }
  if (sha256File(inputPath) !== binding.inputSha256) {
    throw new Error("Coverage inputSha256 does not match delivery input bytes.");
  }

  const inventoryPath = resolveArtifactReference(
    coverage.questionInventory?.ref,
    coverageArtifact.path,
    "questionInventory.ref");
  const inventoryArtifact = loadJsonArtifact(inventoryPath, "question inventory");
  assertSchema("question inventory", inventoryArtifact.value, samplePackageSchemaPath);
  if (inventoryArtifact.sha256 !== coverage.questionInventory.sha256) {
    throw new Error("Coverage questionInventory.sha256 does not match inventory bytes.");
  }
  if (inventoryArtifact.value.subjectPack !== manifest.subjectPack) {
    throw new Error("Question inventory subjectPack does not match delivery manifest.");
  }

  const expectedQuestionRefs = normalizeQuestionRefs(
    coverage.expectedQuestionRefs,
    "coverage.expectedQuestionRefs");
  const inventoryQuestionRefs = normalizeQuestionRefs(
    inventoryArtifact.value.expectedQuestionRefs,
    "questionInventory.expectedQuestionRefs");
  if (!sameOrderedValues(expectedQuestionRefs, inventoryQuestionRefs)) {
    throw new Error("Coverage expectedQuestionRefs must exactly match question inventory.");
  }

  return {
    binding: {
      snapshotId: binding.snapshotId,
      snapshotSha256: binding.snapshotSha256,
      inputSha256: binding.inputSha256,
      manifestSha256: binding.manifestSha256
    },
    expectedQuestionRefs
  };
}

function validateDecisionRecords(decisionArtifacts, coverage, binding) {
  const expectedQuestionRefs = new Set(normalizeQuestionRefs(
    coverage.expectedQuestionRefs,
    "coverage.expectedQuestionRefs"));
  const seenQuestionRefs = new Set();
  const entries = [];

  for (const artifact of decisionArtifacts) {
    const decisionRecord = artifact.value;
    const questionRef = normalizeQuestionRef(decisionRecord.questionRef, "DecisionRecord.questionRef");
    if (decisionRecord.subjectPack !== coverage.subjectPack) {
      throw new Error(`DecisionRecord ${JSON.stringify(questionRef)} subjectPack does not match coverage.`);
    }
    if (!sameBinding(decisionRecord.deliveryBinding, binding)) {
      throw new Error(`DecisionRecord ${JSON.stringify(questionRef)} deliveryBinding does not match coverage.`);
    }
    if (!expectedQuestionRefs.has(questionRef)) {
      throw new Error(`DecisionRecord references unexpected question ${JSON.stringify(questionRef)}.`);
    }
    if (seenQuestionRefs.has(questionRef)) {
      throw new Error(`Duplicate DecisionRecord questionRef ${JSON.stringify(questionRef)}.`);
    }
    seenQuestionRefs.add(questionRef);
    entries.push({ questionRef, decisionRecord, artifact });
  }

  return entries.sort((left, right) => left.questionRef.localeCompare(right.questionRef));
}

function isAcceptedDecision(decisionRecord, binding) {
  const reasons = decisionRecord.decisionReasons;
  return sameBinding(decisionRecord.deliveryBinding, binding)
    && decisionRecord.decision === "accept"
    && decisionRecord.trusted === true
    && decisionRecord.visualReviewPassed === true
    && decisionRecord.reviewRequired === false
    && decisionRecord.reviewQueue === "none"
    && decisionRecord.statusProjection?.trusted === true
    && decisionRecord.statusProjection?.visualReviewPassed === true
    && typeof decisionRecord.evidenceBundleRef === "string"
    && decisionRecord.evidenceBundleRef.trim().length > 0
    && Array.isArray(decisionRecord.trackResultRefs)
    && decisionRecord.trackResultRefs.length > 0
    && decisionRecord.trackResultRefs.every((reference) =>
      typeof reference === "string" && reference.trim().length > 0)
    && Array.isArray(decisionRecord.conflictRefs)
    && decisionRecord.conflictRefs.length === 0
    && Array.isArray(reasons)
    && reasons.includes("evidence_chain_complete")
    && reasons.includes("human_approved")
    && reasons.every((reason) => acceptedDecisionReasons.has(reason));
}

function validateBindingShape(binding, label) {
  if (!binding || typeof binding !== "object") {
    return [`${label} is required.`];
  }
  const errors = [];
  if (typeof binding.snapshotId !== "string" || binding.snapshotId.trim().length === 0) {
    errors.push(`${label}.snapshotId is required.`);
  }
  for (const field of ["snapshotSha256", "inputSha256", "manifestSha256"]) {
    if (!isSha256(binding[field])) {
      errors.push(`${label}.${field} must be a lowercase SHA-256 digest.`);
    }
  }
  return errors;
}

function normalizeQuestionRefs(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must contain at least one question reference.`);
  }
  const normalized = values.map((value) => normalizeQuestionRef(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate question references.`);
  }
  return normalized;
}

function normalizeQuestionRef(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function sameBinding(left, right) {
  return left?.snapshotId === right.snapshotId
    && left?.snapshotSha256 === right.snapshotSha256
    && left?.inputSha256 === right.inputSha256
    && left?.manifestSha256 === right.manifestSha256;
}

function sameOrderedValues(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function buildAggregateId(context) {
  const payload = {
    deliveryBinding: context.binding,
    coverageSha256: context.coverageSha256,
    decisions: context.decisionEntries.map((entry) => ({
      questionRef: entry.questionRef,
      decisionId: entry.decisionRecord.decisionId,
      sha256: entry.artifact.sha256
    }))
  };
  return `delivery-aggregate-${sha256(Buffer.from(JSON.stringify(payload))).slice(0, 16)}`;
}

function loadJsonArtifact(filePath, label) {
  const resolvedPath = requireJsonPath(filePath, label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  };
}

function requireJsonPath(filePath, label) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error(`${label} path is required.`);
  }
  const resolvedPath = path.resolve(filePath);
  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error(`${label} must be a JSON file.`);
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} not found: ${resolvedPath}`);
  }
  return resolvedPath;
}

function resolveArtifactReference(reference, ownerPath, label) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const resolvedPath = PathIsFullyQualified(reference)
    ? path.resolve(reference)
    : path.resolve(path.dirname(ownerPath), reference);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} not found: ${resolvedPath}`);
  }
  return resolvedPath;
}

function resolveManifestPathFromCoverage(coverageArtifact) {
  const manifestSha256 = coverageArtifact.value?.deliveryBinding?.manifestSha256;
  if (!isSha256(manifestSha256)) {
    throw new Error("Coverage deliveryBinding.manifestSha256 is required.");
  }
  throw new Error(
    "manifestPath is required because coverage binds the manifest by digest without a path reference.");
}

function PathIsFullyQualified(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function toReference(targetPath, basePath) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath.split(path.sep).join("/");
}

function projectAggregateContract(aggregate) {
  return {
    schemaVersion: aggregate.schemaVersion,
    kind: aggregate.kind,
    aggregateId: aggregate.aggregateId,
    subjectPack: aggregate.subjectPack,
    deliveryBinding: projectBinding(aggregate.deliveryBinding),
    coverageRef: aggregate.coverageRef,
    coverageSha256: aggregate.coverageSha256,
    decisionRecords: aggregate.decisionRecords.map((entry) => ({
      questionRef: entry.questionRef,
      decisionRecordRef: entry.decisionRecordRef,
      decisionRecordSha256: entry.decisionRecordSha256
    })),
    summary: {
      expectedCount: aggregate.summary.expectedCount,
      decidedCount: aggregate.summary.decidedCount,
      acceptedCount: aggregate.summary.acceptedCount,
      unresolvedCount: aggregate.summary.unresolvedCount,
      unresolvedQuestionRefs: aggregate.summary.unresolvedQuestionRefs
    },
    decision: aggregate.decision,
    trusted: aggregate.trusted,
    visualReviewPassed: aggregate.visualReviewPassed,
    reviewRequired: aggregate.reviewRequired,
    reviewQueue: aggregate.reviewQueue,
    decisionReasons: aggregate.decisionReasons,
    statusProjection: {
      visualReviewPassed: aggregate.statusProjection.visualReviewPassed,
      trusted: aggregate.statusProjection.trusted
    },
    generatedAt: aggregate.generatedAt
  };
}

function projectBinding(binding) {
  return {
    snapshotId: binding.snapshotId,
    snapshotSha256: binding.snapshotSha256,
    inputSha256: binding.inputSha256,
    manifestSha256: binding.manifestSha256
  };
}

function canonicalPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.realpathSync.native(resolvedPath).toLowerCase();
  }
  const parentPath = path.dirname(resolvedPath);
  const canonicalParent = fs.existsSync(parentPath)
    ? fs.realpathSync.native(parentPath)
    : path.resolve(parentPath);
  return path.join(canonicalParent, path.basename(resolvedPath)).toLowerCase();
}

function assertOutputDoesNotAliasInputs(options) {
  if (!options.outputPath) {
    return;
  }
  const outputCanonicalPath = canonicalPath(options.outputPath);
  const inputPaths = [
    ["manifest", options.manifestPath],
    ["coverage", options.coveragePath],
    ...(options.decisionPaths ?? []).map((decisionPath) => ["decision", decisionPath])
  ];
  for (const [label, inputPath] of inputPaths) {
    if (outputCanonicalPath === canonicalPath(inputPath)) {
      throw new Error(`--out must not overwrite ${label} input: ${inputPath}`);
    }
  }
}

function writeFileAtomically(filePath, contents) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function parseArgs(argv) {
  const options = {
    manifestPath: "",
    coveragePath: "",
    decisionPaths: [],
    outputPath: "",
    generatedAt: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = resolveCliPath(requireValue(argv, ++index, arg));
    } else if (arg === "--coverage") {
      options.coveragePath = resolveCliPath(requireValue(argv, ++index, arg));
    } else if (arg === "--decision") {
      options.decisionPaths.push(resolveCliPath(requireValue(argv, ++index, arg)));
    } else if (arg === "--out") {
      options.outputPath = resolveCliPath(requireValue(argv, ++index, arg));
    } else if (arg === "--generated-at") {
      options.generatedAt = requireValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  if (!options.manifestPath || !options.coveragePath) {
    throw new Error(`--manifest and --coverage are required.\n\n${usage()}`);
  }
  assertOutputDoesNotAliasInputs(options);
  return options;
}

function resolveCliPath(value) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const aggregate = compileDeliveryDecisionAggregate(options);
  const json = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (options.outputPath) {
    writeFileAtomically(options.outputPath, json);
  }
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
