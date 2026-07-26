import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { validateDeliveryManifest } from "../latex-renderer/validate-delivery-manifest.mjs";
import { verifyDeliveryDecisionAggregate } from "./delivery-decision-aggregate.mjs";
import { withManifestWriteLock } from "../manifest-write-lock.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const manifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");
const aggregateSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-decision-aggregate.schema.json");
const receiptSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-decision-aggregate-attachment-receipt.schema.json");

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/visual-evidence run attach:aggregate -- \\",
    "    --manifest <delivery-manifest.json> \\",
    "    --aggregate <delivery-decision-aggregate.json>",
    "",
    "The command verifies aggregate sources against the immutable preimage,",
    "writes a receipt before atomically replacing the manifest, and never advances lifecycle."
  ].join("\n");
}

export function attachDeliveryDecisionAggregate(options) {
  const manifestPath = requireJsonFile(options.manifestPath, "manifestPath");
  const aggregatePath = requireJsonFile(options.aggregatePath, "aggregatePath");
  assertDistinctPaths(manifestPath, aggregatePath, "manifestPath and aggregatePath must reference different files.");
  return withManifestWriteLock(manifestPath, () =>
    attachDeliveryDecisionAggregateUnlocked({ ...options, manifestPath, aggregatePath }), options.lockOptions);
}

function attachDeliveryDecisionAggregateUnlocked(options) {
  const { manifestPath, aggregatePath } = options;
  const preimageBackupPath = `${manifestPath}.before-delivery-decision-aggregate.json`;
  const receiptPath = `${manifestPath}.delivery-decision-aggregate-attachment-receipt.json`;
  assertDistinctPaths(aggregatePath, preimageBackupPath, "aggregatePath must not alias the preimage backup.");
  assertDistinctPaths(aggregatePath, receiptPath, "aggregatePath must not alias the attachment receipt.");
  const manifestArtifact = readJsonArtifact(manifestPath, "delivery manifest");
  const aggregateArtifact = readJsonArtifact(aggregatePath, "DeliveryDecisionAggregate");

  assertSchema("delivery manifest", manifestArtifact.value, manifestSchemaPath);
  assertCanonicalManifest(manifestArtifact.value, manifestPath);
  assertSchema("DeliveryDecisionAggregate", aggregateArtifact.value, aggregateSchemaPath);

  const existingAttachment = manifestArtifact.value.review?.deliveryDecisionAggregateAttachment;
  if (existingAttachment) {
    const verification = verifyDeliveryDecisionAggregateAttachment({ manifestPath });
    if (canonicalPath(verification.aggregatePath) !== canonicalPath(aggregatePath)) {
      throw new Error("A different DeliveryDecisionAggregate is already attached to this manifest.");
    }
    return { ...verification, changed: false };
  }

  const verificationSources = captureAggregateVerificationSources(manifestArtifact, aggregateArtifact);
  const aggregateVerification = verifyDeliveryDecisionAggregate({
    aggregatePath,
    manifestPath
  });
  assertSourceSnapshotUnchanged(verificationSources);
  const aggregate = aggregateVerification.aggregate;
  assertTrustedAggregate(aggregate);
  if (aggregate.deliveryBinding.manifestSha256 !== manifestArtifact.sha256) {
    throw new Error("DeliveryDecisionAggregate manifest preimage does not match current manifest bytes.");
  }

  const attachmentId = buildAttachmentId(aggregateArtifact.sha256, manifestArtifact.sha256);
  const aggregateRef = toManifestReference(aggregatePath, manifestPath);
  const preimageBackupRef = toManifestReference(preimageBackupPath, manifestPath);
  const receiptRef = toManifestReference(receiptPath, manifestPath);
  const updatedManifest = structuredClone(manifestArtifact.value);
  updatedManifest.review.deliveryDecisionAggregateAttachment = {
    attachmentId,
    aggregateRef,
    aggregateSha256: aggregateArtifact.sha256,
    manifestPreimageSha256: manifestArtifact.sha256,
    preimageBackupRef,
    receiptRef
  };
  updatedManifest.status.visualReviewPassed = true;
  updatedManifest.status.trusted = true;
  assertSchema("updated delivery manifest", updatedManifest, manifestSchemaPath);
  assertCanonicalManifest(updatedManifest, manifestPath);

  const resultText = stringifyJson(updatedManifest);
  const receipt = {
    schemaVersion: "1.0",
    kind: "delivery-decision-aggregate-attachment-receipt",
    attachmentId,
    aggregateRef,
    aggregateSha256: aggregateArtifact.sha256,
    manifestPreimageSha256: manifestArtifact.sha256,
    manifestResultSha256: sha256(Buffer.from(resultText, "utf8")),
    preimageBackupRef,
    createdAt: options.createdAt ?? new Date().toISOString()
  };
  assertSchema("attachment receipt", receipt, receiptSchemaPath);

  options.testHooks?.beforeCommit?.();
  assertSourceSnapshotUnchanged(verificationSources);

  // The receipt is committed first. A process interruption can leave an orphan receipt, but not a manifest reference to a missing receipt.
  atomicWriteBuffer(preimageBackupPath, manifestArtifact.bytes);
  atomicWriteJson(receiptPath, receipt);
  options.testHooks?.afterReceiptWrite?.();
  options.testHooks?.beforeManifestWrite?.();
  assertSourceSnapshotUnchanged(verificationSources);
  atomicWriteText(manifestPath, resultText);
  options.testHooks?.afterManifestWrite?.();

  let verification;
  try {
    verification = verifyDeliveryDecisionAggregateAttachment({ manifestPath });
  } catch (error) {
    if (sha256(fs.readFileSync(manifestPath)) === receipt.manifestResultSha256) {
      atomicWriteBuffer(manifestPath, manifestArtifact.bytes);
    }
    throw new Error(
      `Aggregate attachment post-write verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ...verification,
    changed: true
  };
}

export function verifyDeliveryDecisionAggregateAttachment(options) {
  const manifestPath = requireJsonFile(options.manifestPath, "manifestPath");
  const manifestArtifact = readJsonArtifact(manifestPath, "delivery manifest");
  assertSchema("delivery manifest", manifestArtifact.value, manifestSchemaPath);
  assertCanonicalManifest(manifestArtifact.value, manifestPath);
  const attachment = manifestArtifact.value.review?.deliveryDecisionAggregateAttachment;
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
    throw new Error("deliveryDecisionAggregateAttachment is required.");
  }

  const aggregatePath = resolveManifestReference(attachment.aggregateRef, manifestPath, "aggregateRef");
  const backupPath = resolveManifestReference(attachment.preimageBackupRef, manifestPath, "preimageBackupRef");
  const receiptPath = resolveManifestReference(attachment.receiptRef, manifestPath, "receiptRef");
  const aggregateArtifact = readJsonArtifact(aggregatePath, "DeliveryDecisionAggregate");
  const backupArtifact = readJsonArtifact(backupPath, "manifest preimage backup");
  const receiptArtifact = readJsonArtifact(receiptPath, "attachment receipt");
  const receipt = receiptArtifact.value;
  const verificationSources = captureAggregateVerificationSources(
    backupArtifact,
    aggregateArtifact,
    [manifestArtifact, receiptArtifact]);
  assertSchema("DeliveryDecisionAggregate", aggregateArtifact.value, aggregateSchemaPath);
  assertSchema("attachment receipt", receipt, receiptSchemaPath);

  if (attachment.aggregateSha256 !== aggregateArtifact.sha256
    || attachment.manifestPreimageSha256 !== backupArtifact.sha256
    || receipt.aggregateSha256 !== aggregateArtifact.sha256
    || receipt.manifestPreimageSha256 !== backupArtifact.sha256
    || receipt.manifestResultSha256 !== manifestArtifact.sha256) {
    throw new Error("Aggregate attachment hash chain does not match referenced artifacts.");
  }
  for (const fieldName of ["attachmentId", "aggregateRef", "preimageBackupRef"]) {
    if (attachment[fieldName] !== receipt[fieldName]) {
      throw new Error(`Aggregate attachment receipt ${fieldName} does not match manifest attachment.`);
    }
  }
  if (manifestArtifact.value.status?.visualReviewPassed !== true || manifestArtifact.value.status?.trusted !== true) {
    throw new Error("Aggregate attachment requires trusted manifest status projection.");
  }

  const aggregateVerification = verifyDeliveryDecisionAggregate({
    aggregatePath,
    manifestPath: backupPath
  });
  assertTrustedAggregate(aggregateVerification.aggregate);
  assertSourceSnapshotUnchanged(verificationSources);
  return {
    kind: "delivery-decision-aggregate-attachment",
    manifestPath,
    aggregatePath,
    preimageBackupPath: backupPath,
    receiptPath,
    attachmentId: attachment.attachmentId,
    manifestPreimageSha256: attachment.manifestPreimageSha256,
    manifestResultSha256: receipt.manifestResultSha256,
    visualReviewPassed: true,
    trusted: true
  };
}

function assertTrustedAggregate(aggregate) {
  if (aggregate.kind !== "delivery-decision-aggregate"
    || aggregate.decision !== "accept"
    || aggregate.trusted !== true
    || aggregate.visualReviewPassed !== true
    || aggregate.reviewRequired !== false
    || aggregate.reviewQueue !== "none"
    || aggregate.statusProjection?.trusted !== true
    || aggregate.statusProjection?.visualReviewPassed !== true) {
    throw new Error("Aggregate attachment requires a fully trusted DeliveryDecisionAggregate.");
  }
}

function assertCanonicalManifest(manifest, manifestPath) {
  const errors = validateDeliveryManifest(manifest, manifestPath, manifestSchemaPath);
  if (errors.length > 0) {
    throw new Error(`delivery manifest semantic validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = requireJsonFile(filePath, label);
  const bytes = fs.readFileSync(resolvedPath);
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256(bytes),
    value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
    label
  };
}

function requireJsonFile(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const resolvedPath = path.resolve(value);
  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error(`${label} must point to a JSON file.`);
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`${label} not found: ${resolvedPath}`);
  }
  return fs.realpathSync.native(resolvedPath);
}

function resolveManifestReference(reference, manifestPath, label) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const resolvedPath = path.isAbsolute(reference)
    ? path.resolve(reference)
    : path.resolve(path.dirname(manifestPath), reference);
  return requireJsonFile(resolvedPath, label);
}

function toManifestReference(targetPath, manifestPath) {
  return path.relative(path.dirname(manifestPath), targetPath).split(path.sep).join("/");
}

function buildAttachmentId(aggregateSha256, preimageSha256) {
  return `delivery-aggregate-attachment-${sha256(Buffer.from(`${aggregateSha256}:${preimageSha256}`)).slice(0, 16)}`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function captureAggregateVerificationSources(manifestArtifact, aggregateArtifact, extraArtifacts = []) {
  const coveragePath = resolveArtifactReference(
    aggregateArtifact.value.coverageRef,
    aggregateArtifact.path,
    "coverageRef");
  const coverageArtifact = readJsonArtifact(coveragePath, "delivery question coverage");
  const decisionArtifacts = aggregateArtifact.value.decisionRecords.map((entry) =>
    readJsonArtifact(
      resolveArtifactReference(entry.decisionRecordRef, aggregateArtifact.path, "decisionRecordRef"),
      "DecisionRecord"));
  const snapshotArtifact = readFileArtifact(
    resolveArtifactReference(manifestArtifact.value.snapshotPath, manifestArtifact.path, "snapshotPath"),
    "resolved snapshot");
  const inputArtifact = readFileArtifact(
    resolveArtifactReference(manifestArtifact.value.input, manifestArtifact.path, "input"),
    "delivery input");
  const inventoryArtifact = readFileArtifact(
    resolveArtifactReference(
      coverageArtifact.value.questionInventory?.ref,
      coverageArtifact.path,
      "questionInventory.ref"),
    "question inventory");

  const sources = [
    manifestArtifact,
    aggregateArtifact,
    coverageArtifact,
    ...decisionArtifacts,
    snapshotArtifact,
    inputArtifact,
    inventoryArtifact,
    ...extraArtifacts
  ];
  return new Map(sources.map((artifact) => [canonicalPath(artifact.path), artifact]));
}

function assertSourceSnapshotUnchanged(sourceSnapshot) {
  for (const artifact of sourceSnapshot.values()) {
    if (sha256(fs.readFileSync(artifact.path)) !== artifact.sha256) {
      throw new Error(`${artifact.label} changed during aggregate source verification or before attachment write.`);
    }
  }
}

function readFileArtifact(filePath, label) {
  const resolvedPath = requireFile(filePath, label);
  const bytes = fs.readFileSync(resolvedPath);
  return { path: resolvedPath, bytes, sha256: sha256(bytes), label };
}

function resolveArtifactReference(reference, ownerPath, label) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const resolvedPath = path.isAbsolute(reference)
    ? path.resolve(reference)
    : path.resolve(path.dirname(ownerPath), reference);
  return requireFile(resolvedPath, label);
}

function requireFile(value, label) {
  const resolvedPath = path.resolve(value);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`${label} not found: ${resolvedPath}`);
  }
  return fs.realpathSync.native(resolvedPath);
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

function assertDistinctPaths(left, right, message) {
  if (canonicalPath(left) === canonicalPath(right)) {
    throw new Error(message);
  }
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, stringifyJson(value));
}

function atomicWriteText(filePath, contents) {
  atomicWriteBuffer(filePath, Buffer.from(contents, "utf8"));
}

function atomicWriteBuffer(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = fs.openSync(temporaryPath, "wx");
    fs.writeFileSync(handle, contents);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporaryPath, filePath);
    flushDirectoryBestEffort(path.dirname(filePath));
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
    fs.rmSync(temporaryPath, { force: true });
  }
}

function flushDirectoryBestEffort(directoryPath) {
  let handle;
  try {
    handle = fs.openSync(directoryPath, "r");
    fs.fsyncSync(handle);
  } catch {
    // Windows filesystems do not consistently permit directory handles; file data was fsynced before rename.
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

function parseArgs(argv) {
  const options = { manifestPath: "", aggregatePath: "", createdAt: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = resolveCliPath(requireValue(argv, ++index, arg));
    } else if (arg === "--aggregate") {
      options.aggregatePath = resolveCliPath(requireValue(argv, ++index, arg));
    } else if (arg === "--created-at") {
      options.createdAt = requireValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return null;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  if (!options.manifestPath || !options.aggregatePath) {
    throw new Error(`--manifest and --aggregate are required.\n\n${usage()}`);
  }
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
  process.stdout.write(`${JSON.stringify(attachDeliveryDecisionAggregate(options), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
