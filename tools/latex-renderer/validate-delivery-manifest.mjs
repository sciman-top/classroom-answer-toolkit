import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgvFlags, sha256Hex } from "../shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { loadRequiredResolvedSnapshot } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const defaultSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");
const placedAnswerGraphicSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "placed-answer-graphic.schema.json");

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: { manifest: true, schema: true },
    defaults: { manifest: null, schema: defaultSchemaPath },
    help: true
  });
}

function resolveManifestRelativePath(filePath, manifestDir) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(manifestDir, filePath);
}

function readJsonWithBom(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function normalizePathForComparison(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function collectFilePaths(directoryPath) {
  if (!isDirectory(directoryPath)) {
    return [];
  }

  const paths = [];
  const visit = (currentDirectory) => {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        paths.push(entryPath);
      }
    }
  };

  visit(directoryPath);
  return paths;
}

function validateFileIntegrity(errors, entry, expectedPath, label, manifestDir) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`integrity.${label} must be an object.`);
    return;
  }

  if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
    errors.push(`integrity.${label}.path must be a non-empty string.`);
    return;
  }

  const integrityPath = resolveManifestRelativePath(entry.path, manifestDir);
  if (expectedPath
      && normalizePathForComparison(integrityPath) !== normalizePathForComparison(expectedPath)) {
    errors.push(`integrity.${label}.path must match ${label}.`);
  }

  if (!isFile(integrityPath)) {
    errors.push(`integrity.${label}.path not found: ${entry.path}`);
    return;
  }

  const bytes = fs.readFileSync(integrityPath);
  if (entry.bytes !== bytes.byteLength) {
    errors.push(`integrity.${label}.bytes does not match the current file.`);
  }

  const sha256 = sha256Hex(bytes);
  if (entry.sha256 !== sha256) {
    errors.push(`integrity.${label}.sha256 does not match the current file.`);
  }
}

function validateIntegrity(errors, manifest, manifestDir) {
  if (manifest.schemaVersion === "1.0") {
    return; // Legacy 1.0 manifests predate integrity metadata.
  }
  if (manifest.schemaVersion !== "1.1") {
    errors.push(`Unsupported delivery manifest schemaVersion: ${JSON.stringify(manifest.schemaVersion)} (expected "1.0" or "1.1").`);
    return;
  }

  const integrity = manifest.integrity;
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    errors.push("schemaVersion 1.1 requires integrity metadata.");
    return;
  }

  if (integrity.algorithm !== "sha256") {
    errors.push("integrity.algorithm must be sha256.");
  }

  const inputPath = typeof manifest.input === "string"
    ? resolveManifestRelativePath(manifest.input, manifestDir)
    : null;
  const outputPath = typeof manifest.output === "string"
    ? resolveManifestRelativePath(manifest.output, manifestDir)
    : null;
  const snapshotPath = typeof manifest.snapshotPath === "string"
    ? resolveManifestRelativePath(manifest.snapshotPath, manifestDir)
    : null;
  validateFileIntegrity(errors, integrity.input, inputPath, "input", manifestDir);
  validateFileIntegrity(errors, integrity.output, outputPath, "output", manifestDir);
  validateFileIntegrity(errors, integrity.snapshot, snapshotPath, "snapshot", manifestDir);

  if (!Array.isArray(integrity.reviewFiles)) {
    errors.push("integrity.reviewFiles must be an array.");
    return;
  }

  if (manifest.status?.reviewArtifactReady !== true) {
    if (integrity.reviewFiles.length > 0) {
      errors.push("integrity.reviewFiles must be empty when review artifacts are not ready.");
    }
    return;
  }

  const reviewOutputDir = typeof manifest.review?.outputDir === "string"
    ? resolveManifestRelativePath(manifest.review.outputDir, manifestDir)
    : null;
  const actualReviewPaths = reviewOutputDir ? collectFilePaths(reviewOutputDir) : [];
  const actualPathKeys = new Set(actualReviewPaths.map(normalizePathForComparison));
  const boundPathKeys = new Set();

  for (const [index, entry] of integrity.reviewFiles.entries()) {
    const label = `reviewFiles[${index}]`;
    const entryPath = typeof entry?.path === "string"
      ? resolveManifestRelativePath(entry.path, manifestDir)
      : null;
    if (entryPath) {
      const entryKey = normalizePathForComparison(entryPath);
      if (boundPathKeys.has(entryKey)) {
        errors.push(`integrity.${label}.path is duplicated.`);
      }
      boundPathKeys.add(entryKey);
      if (!actualPathKeys.has(entryKey)) {
        errors.push(`integrity.${label}.path is not a current review artifact.`);
      }
    }
    validateFileIntegrity(errors, entry, entryPath, label, manifestDir);
  }

  for (const actualPath of actualReviewPaths) {
    if (!boundPathKeys.has(normalizePathForComparison(actualPath))) {
      errors.push(`integrity.reviewFiles is missing current review artifact: ${actualPath}`);
    }
  }
}

function addPlacementFieldMismatchErrors(errors, item, placement, itemIndex) {
  for (const fieldName of ["placedGraphicId", "graphicId", "artifactId", "questionRef", "placementMode"]) {
    if (typeof placement?.[fieldName] !== "string" || placement[fieldName].trim().length === 0) {
      continue;
    }

    if (item?.[fieldName] !== placement[fieldName]) {
      errors.push(`graphics.items[${itemIndex}].${fieldName} must match placement.${fieldName}.`);
    }
  }
}

function validateOcrMetadata(errors, ocr) {
  const allowedStatuses = new Set(["not-requested", "requested", "ok", "failed"]);
  if (!ocr || typeof ocr !== "object" || Array.isArray(ocr)) {
    errors.push("ocr must be an object.");
    return;
  }

  if (typeof ocr.status !== "string" || !allowedStatuses.has(ocr.status)) {
    errors.push("ocr.status must be one of not-requested, requested, ok, failed.");
    return;
  }

  if (ocr.status !== "not-requested") {
    for (const fieldName of ["provider", "version", "language"]) {
      if (typeof ocr[fieldName] !== "string" || ocr[fieldName].trim().length === 0) {
        errors.push(`ocr.${fieldName} must be a non-empty string when OCR is ${ocr.status}.`);
      }
    }
  }

  if (ocr.status === "not-requested") {
    for (const fieldName of ["provider", "version", "language"]) {
      if (ocr[fieldName] !== undefined && ocr[fieldName] !== null) {
        errors.push(`ocr.${fieldName} must be omitted when OCR is not requested.`);
      }
    }
  }

  if (ocr.status === "failed" && (typeof ocr.error !== "string" || ocr.error.trim().length === 0)) {
    errors.push("ocr.error must be a non-empty string when OCR failed.");
  }

  if (ocr.pageCount !== undefined && (!Number.isFinite(ocr.pageCount) || ocr.pageCount < 0)) {
    errors.push("ocr.pageCount must be a non-negative number.");
  }
}

function validateReviewMetadata(errors, manifest, manifestDir) {
  const review = manifest.review;
  const status = manifest.status ?? {};
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    errors.push("review must be an object.");
    return;
  }

  const reviewOutputDir = typeof review.outputDir === "string" && review.outputDir.trim().length > 0
    ? resolveManifestRelativePath(review.outputDir, manifestDir)
    : null;
  const reviewManifestPath = typeof review.manifestPath === "string" && review.manifestPath.trim().length > 0
    ? resolveManifestRelativePath(review.manifestPath, manifestDir)
    : null;

  if (status.reviewArtifactReady === true) {
    if (!reviewOutputDir || !isDirectory(reviewOutputDir)) {
      errors.push("status.reviewArtifactReady cannot be true unless review.outputDir is a directory.");
    }

    if (!reviewManifestPath || !isFile(reviewManifestPath)) {
      errors.push("status.reviewArtifactReady cannot be true unless review.manifestPath is a file.");
    }
  }

}

function validateReferencedSnapshot(errors, manifest, manifestDir) {
  if (typeof manifest.snapshotPath !== "string" || manifest.snapshotPath.trim().length === 0) {
    errors.push("snapshotPath must be a non-empty string.");
    return;
  }

  const snapshotPath = resolveManifestRelativePath(manifest.snapshotPath, manifestDir);
  let snapshot;
  try {
    snapshot = loadRequiredResolvedSnapshot(snapshotPath);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `Resolved snapshot is not valid JSON: ${snapshotPath}`);
    return;
  }

  const snapshotId = snapshot.snapshotId;
  const snapshotVersion = snapshot.subjectPack?.version;
  const snapshotProfile = snapshot.activeProfile?.name;
  const snapshotSubjectPack = snapshot.subjectPack?.assetId;

  if (manifest.snapshotId !== snapshotId) {
    errors.push("snapshotId must match referenced snapshot.snapshotId.");
  }

  if (manifest.snapshot?.id !== snapshotId) {
    errors.push("snapshot.id must match referenced snapshot.snapshotId.");
  }

  if (manifest.snapshot?.version !== snapshotVersion) {
    errors.push("snapshot.version must match referenced snapshot.subjectPack.version.");
  }

  if (manifest.snapshot?.profile !== snapshotProfile) {
    errors.push("snapshot.profile must match referenced snapshot.activeProfile.name.");
  }

  if (manifest.subjectPack !== snapshotSubjectPack) {
    errors.push("subjectPack must match referenced snapshot.subjectPack.assetId.");
  }
}

export function validateDeliveryManifest(
  manifest,
  manifestPath,
  schemaPath = defaultSchemaPath
) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifestPath);
  const errors = validateValueAgainstSchema(manifest, schemaPath);

  if (manifest.kind !== "delivery-manifest") {
    errors.push(`Expected kind "delivery-manifest", got ${JSON.stringify(manifest.kind)}.`);
  }

  if (manifest.snapshotId !== manifest.snapshot?.id) {
    errors.push("Top-level snapshotId must match snapshot.id.");
  }

  if (manifest.profile !== manifest.snapshot?.profile) {
    errors.push("Top-level profile must match snapshot.profile.");
  }

  if (typeof manifest.subjectPack !== "string" || manifest.subjectPack.trim().length === 0) {
    errors.push("subjectPack must be a non-empty string.");
  }

  if (typeof manifest.snapshot?.version !== "string" || manifest.snapshot.version.trim().length === 0) {
    errors.push("snapshot.version must be a non-empty string.");
  }

  if (typeof manifest.snapshot?.profile !== "string" || manifest.snapshot.profile.trim().length === 0) {
    errors.push("snapshot.profile must be a non-empty string.");
  }

  validateReferencedSnapshot(errors, manifest, manifestDir);

  if (typeof manifest.input === "string" && !manifest.input.toLowerCase().endsWith(".md")) {
    errors.push("input should point to a Markdown file.");
  }

  if (typeof manifest.output === "string" && !manifest.output.toLowerCase().endsWith(".pdf")) {
    errors.push("output should point to a PDF file.");
  }
  if (manifest.status?.deliveryComplete === true) {
    const outputPath = typeof manifest.output === "string" && manifest.output.trim().length > 0
      ? resolveManifestRelativePath(manifest.output, manifestDir)
      : null;
    if (!outputPath || !isFile(outputPath)) {
      errors.push("status.deliveryComplete cannot be true unless output is a file.");
    }
  }

  validateOcrMetadata(errors, manifest.ocr);
  validateReviewMetadata(errors, manifest, manifestDir);
  validateIntegrity(errors, manifest, manifestDir);

  if (manifest.graphics !== undefined && !Array.isArray(manifest.graphics?.items)) {
    errors.push("graphics.items must be an array.");
  } else if (Array.isArray(manifest.graphics?.items)) {
    for (const [index, item] of manifest.graphics.items.entries()) {
      if (typeof item?.placementPath !== "string" || item.placementPath.trim().length === 0) {
        errors.push(`graphics.items[${index}].placementPath must be a non-empty string.`);
        continue;
      }

      const placementPath = resolveManifestRelativePath(item.placementPath, manifestDir);
      if (!fs.existsSync(placementPath)) {
        errors.push(`graphics.items[${index}].placementPath not found: ${item.placementPath}`);
        continue;
      }

      let placement;
      try {
        placement = readJsonWithBom(placementPath);
      } catch {
        errors.push(`graphics.items[${index}].placementPath is not valid JSON: ${item.placementPath}`);
        continue;
      }

      for (const placementError of validateValueAgainstSchema(placement, placedAnswerGraphicSchemaPath)) {
        errors.push(`graphics.items[${index}].placementPath schema error: ${placementError}`);
      }

      if (placement.kind !== "placed-answer-graphic") {
        errors.push(`graphics.items[${index}].placementPath must point to a placed-answer-graphic.`);
      }

      addPlacementFieldMismatchErrors(errors, item, placement, index);

      if (typeof placement.previewPath === "string" && placement.previewPath.trim().length > 0) {
        const expectedPreviewPath = path.resolve(path.dirname(placementPath), placement.previewPath);
        if (typeof item.previewPath !== "string" || item.previewPath.trim().length === 0) {
          errors.push(`graphics.items[${index}].previewPath must match placement.previewPath.`);
        } else {
          const previewPath = resolveManifestRelativePath(item.previewPath, manifestDir);
          if (path.resolve(previewPath) !== expectedPreviewPath) {
            errors.push(`graphics.items[${index}].previewPath must match placement.previewPath.`);
          }

          if (!fs.existsSync(previewPath)) {
            errors.push(`graphics.items[${index}].previewPath not found: ${item.previewPath}`);
          }
        }
      } else if (typeof item.previewPath === "string") {
        const previewPath = resolveManifestRelativePath(item.previewPath, manifestDir);
        if (!fs.existsSync(previewPath)) {
          errors.push(`graphics.items[${index}].previewPath not found: ${item.previewPath}`);
        }
      }
    }
  }

  if (typeof manifest.status?.toolchainPassed !== "boolean") {
    errors.push("status.toolchainPassed must be a boolean.");
  }

  if (typeof manifest.status?.deliveryComplete !== "boolean") {
    errors.push("status.deliveryComplete must be a boolean.");
  }

  if (typeof manifest.status?.reviewArtifactReady !== "boolean") {
    errors.push("status.reviewArtifactReady must be a boolean.");
  }

  return errors;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node validate-delivery-manifest.mjs --manifest <delivery-manifest.json> [--schema <schema.json>]`);
    process.exit(0);
  }

  if (!options.manifest) {
    fail("Missing required --manifest argument.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const manifestPath = path.resolve(callerCwd, options.manifest);
  const schemaPath = path.resolve(callerCwd, options.schema);

  if (!fs.existsSync(manifestPath)) {
    fail(`Delivery manifest not found: ${manifestPath}`);
  }

  const manifest = readJsonWithBom(manifestPath);
  const errors = validateDeliveryManifest(manifest, manifestPath, schemaPath);
  if (errors.length > 0) {
    fail(`Delivery manifest validation failed for ${manifestPath}:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  console.log(`Validated delivery manifest: ${manifestPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
