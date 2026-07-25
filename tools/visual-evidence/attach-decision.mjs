import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const decisionRecordSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "decision-record.schema.json");
const deliveryManifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/visual-evidence run attach:decision -- --manifest <delivery-manifest.json> --decision <decision-record.json>",
    "",
    "The command validates both contracts, preserves a rollback backup, and atomically updates:",
    "  review.visualDecisionRef",
    "  status.visualReviewPassed",
    "  status.trusted"
  ].join("\n");
}

export function attachDecisionRecord(options) {
  const manifestPath = requireJsonPath(options.manifestPath, "manifestPath");
  const decisionPath = requireJsonPath(options.decisionPath, "decisionPath");
  const backupPath = `${manifestPath}.before-visual-decision.json`;
  const manifest = readJson(manifestPath);
  const decisionRecord = readJson(decisionPath);

  assertSchema("DecisionRecord", decisionRecord, decisionRecordSchemaPath);
  assertSchema("delivery manifest", manifest, deliveryManifestSchemaPath);
  assertAttachmentContract(manifest, decisionRecord);

  const visualDecisionRef = toManifestReference(decisionPath, manifestPath);
  const projection = decisionRecord.statusProjection;
  const alreadyAttached = resolveManifestReference(manifest.review.visualDecisionRef, manifestPath) === decisionPath
    && manifest.status.visualReviewPassed === projection.visualReviewPassed
    && manifest.status.trusted === projection.trusted;

  if (alreadyAttached) {
    return buildResult({
      manifestPath,
      decisionPath,
      backupPath,
      visualDecisionRef,
      projection,
      changed: false
    });
  }

  const updatedManifest = structuredClone(manifest);
  updatedManifest.review.visualDecisionRef = visualDecisionRef;
  updatedManifest.status.visualReviewPassed = projection.visualReviewPassed;
  updatedManifest.status.trusted = projection.trusted;
  assertSchema("updated delivery manifest", updatedManifest, deliveryManifestSchemaPath);
  assertManifestProjectionLifecycle(updatedManifest, projection);

  atomicCopyFile(manifestPath, backupPath);
  atomicWriteJson(manifestPath, updatedManifest);

  return buildResult({
    manifestPath,
    decisionPath,
    backupPath,
    visualDecisionRef,
    projection,
    changed: true
  });
}

function assertAttachmentContract(manifest, decisionRecord) {
  if (manifest.kind !== "delivery-manifest") {
    throw new Error(`Expected delivery-manifest, got ${JSON.stringify(manifest.kind)}.`);
  }
  if (decisionRecord.kind !== "decision-record") {
    throw new Error(`Expected decision-record, got ${JSON.stringify(decisionRecord.kind)}.`);
  }
  if (manifest.subjectPack !== decisionRecord.subjectPack) {
    throw new Error(
      `subjectPack mismatch: manifest=${JSON.stringify(manifest.subjectPack)}, decision=${JSON.stringify(decisionRecord.subjectPack)}.`
    );
  }
  if (!decisionRecord.statusProjection || typeof decisionRecord.statusProjection !== "object") {
    throw new Error("DecisionRecord.statusProjection is required for manifest attachment.");
  }
  if (decisionRecord.statusProjection.visualReviewPassed !== decisionRecord.visualReviewPassed) {
    throw new Error("DecisionRecord.statusProjection.visualReviewPassed must match visualReviewPassed.");
  }
  if (decisionRecord.statusProjection.trusted !== decisionRecord.trusted) {
    throw new Error("DecisionRecord.statusProjection.trusted must match trusted.");
  }
  if (decisionRecord.trusted === true) {
    if (decisionRecord.visualReviewPassed !== true) {
      throw new Error("A trusted DecisionRecord requires visualReviewPassed=true.");
    }
    if (decisionRecord.decision !== "accept"
      || decisionRecord.reviewRequired !== false
      || decisionRecord.reviewQueue !== "none") {
      throw new Error("A trusted DecisionRecord must be accepted with no pending review queue.");
    }
  }
  if (decisionRecord.visualReviewPassed === true && decisionRecord.trusted !== true) {
    throw new Error("visualReviewPassed=true cannot be projected while trusted=false.");
  }
  if (decisionRecord.visualReviewPassed === true || decisionRecord.trusted === true) {
    throw new Error(
      "Positive trust projection requires a delivery-level aggregate with snapshot binding and complete question coverage."
    );
  }

  assertManifestProjectionLifecycle(manifest, decisionRecord.statusProjection);
}

function assertManifestProjectionLifecycle(manifest, projection) {
  const lifecycleState = manifest.review?.lifecycle?.state;
  if (projection.visualReviewPassed === true
    && !["visually_reviewed", "approved", "published"].includes(lifecycleState)) {
    throw new Error("visualReviewPassed=true requires a visually_reviewed, approved, or published manifest lifecycle.");
  }
  if (projection.visualReviewPassed === false
    && ["approved", "published"].includes(lifecycleState)) {
    throw new Error("visualReviewPassed=false cannot be attached to an approved or published manifest.");
  }
  if (projection.trusted === true && !["approved", "published"].includes(lifecycleState)) {
    throw new Error("trusted=true requires an approved or published manifest lifecycle.");
  }
}

function assertSchema(label, value, schemaPath) {
  const errors = validateValueAgainstSchema(value, schemaPath);
  if (errors.length > 0) {
    throw new Error(`${label} schema validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function requireJsonPath(value, optionName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${optionName} is required.`);
  }
  const resolved = path.resolve(value);
  if (path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error(`${optionName} must point to a JSON file.`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`${optionName} not found: ${resolved}`);
  }
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function toManifestReference(decisionPath, manifestPath) {
  const manifestDirectory = path.dirname(manifestPath);
  const relativePath = path.relative(manifestDirectory, decisionPath);
  if (path.isAbsolute(relativePath)) {
    return decisionPath;
  }
  return relativePath.split(path.sep).join("/");
}

function resolveManifestReference(reference, manifestPath) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    return null;
  }
  return path.resolve(path.dirname(manifestPath), reference);
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function atomicCopyFile(sourcePath, destinationPath) {
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporaryPath, destinationPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function buildResult(context) {
  return {
    kind: "visual-decision-attachment",
    manifestPath: context.manifestPath,
    decisionPath: context.decisionPath,
    backupPath: context.backupPath,
    visualDecisionRef: context.visualDecisionRef,
    visualReviewPassed: context.projection.visualReviewPassed,
    trusted: context.projection.trusted,
    changed: context.changed
  };
}

function parseArgs(argv) {
  const options = {
    manifestPath: "",
    decisionPath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = path.resolve(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--decision") {
      options.decisionPath = path.resolve(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return null;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!options.manifestPath || !options.decisionPath) {
    throw new Error(`--manifest and --decision are required.\n\n${usage()}`);
  }
  return options;
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
  const result = attachDecisionRecord(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
