import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  const options = {
    manifest: null,
    schema: defaultSchemaPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--manifest") {
      options.manifest = argv[++index];
      continue;
    }

    if (arg.startsWith("--manifest=")) {
      options.manifest = arg.slice("--manifest=".length);
      continue;
    }

    if (arg === "--schema") {
      options.schema = argv[++index];
      continue;
    }

    if (arg.startsWith("--schema=")) {
      options.schema = arg.slice("--schema=".length);
      continue;
    }
  }

  return options;
}

function resolveManifestRelativePath(filePath, manifestDir) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(manifestDir, filePath);
}

function readJsonWithBom(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
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

  const reviewLifecycleState = review.lifecycle?.state;
  const reviewOutputDir = typeof review.outputDir === "string" && review.outputDir.trim().length > 0
    ? resolveManifestRelativePath(review.outputDir, manifestDir)
    : null;
  const reviewManifestPath = typeof review.manifestPath === "string" && review.manifestPath.trim().length > 0
    ? resolveManifestRelativePath(review.manifestPath, manifestDir)
    : null;

  if (status.reviewArtifactReady === true) {
    if (!reviewOutputDir || !fs.existsSync(reviewOutputDir)) {
      errors.push("status.reviewArtifactReady cannot be true unless review.outputDir exists.");
    }

    if (!reviewManifestPath || !fs.existsSync(reviewManifestPath)) {
      errors.push("status.reviewArtifactReady cannot be true unless review.manifestPath exists.");
    }
  }

  if (reviewLifecycleState === "draft" && status.reviewArtifactReady === true) {
    errors.push("review.lifecycle.state cannot be draft when review artifacts are ready.");
  }

  if (status.visualReviewPassed === true
    && !["visually_reviewed", "approved", "published"].includes(reviewLifecycleState)) {
    errors.push("status.visualReviewPassed=true requires review.lifecycle.state to be visually_reviewed, approved, or published.");
  }

  if (status.visualReviewPassed === false
    && ["approved", "published"].includes(reviewLifecycleState)) {
    errors.push("status.visualReviewPassed=false cannot coexist with an approved or published review lifecycle.");
  }

  if (status.trusted === true && !["approved", "published"].includes(reviewLifecycleState)) {
    errors.push("status.trusted=true requires review.lifecycle.state to be approved or published.");
  }

  if (Array.isArray(review.feedbackRefs)) {
    for (const [index, feedbackRef] of review.feedbackRefs.entries()) {
      if (typeof feedbackRef !== "string" || feedbackRef.trim().length === 0) {
        errors.push(`review.feedbackRefs[${index}] must be a non-empty string.`);
      }
    }
  }

  if (review.visualDecisionRef !== undefined
    && (typeof review.visualDecisionRef !== "string" || review.visualDecisionRef.trim().length === 0)) {
    errors.push("review.visualDecisionRef must be a non-empty string when provided.");
  }
}

function validatePolicyMetadata(errors, manifest) {
  if (manifest.policy === undefined) {
    return;
  }

  if (!manifest.policy || typeof manifest.policy !== "object" || Array.isArray(manifest.policy)) {
    errors.push("policy must be an object when provided.");
    return;
  }

  for (const fieldName of ["visualPolicyVersion", "optimizationVersion"]) {
    if (manifest.policy[fieldName] !== undefined
      && (typeof manifest.policy[fieldName] !== "string" || manifest.policy[fieldName].trim().length === 0)) {
      errors.push(`policy.${fieldName} must be a non-empty string when provided.`);
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
  const manifestDir = path.dirname(manifestPath);
  const schemaPath = path.resolve(callerCwd, options.schema);

  if (!fs.existsSync(manifestPath)) {
    fail(`Delivery manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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

  validateOcrMetadata(errors, manifest.ocr);
  validateReviewMetadata(errors, manifest, manifestDir);
  validatePolicyMetadata(errors, manifest);

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

  if (typeof manifest.status?.trusted !== "boolean") {
    errors.push("status.trusted must be a boolean.");
  }

  if (manifest.status?.trusted === true && manifest.status?.visualReviewPassed !== true) {
    errors.push("status.trusted cannot be true unless status.visualReviewPassed is true.");
  }

  if (errors.length > 0) {
    fail(`Delivery manifest validation failed for ${manifestPath}:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  console.log(`Validated delivery manifest: ${manifestPath}`);
}

main();
