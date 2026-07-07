import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { loadRequiredResolvedSnapshot } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const deliveryManifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    snapshotPath: null,
    reviewDir: null,
    reviewManifestPath: null,
    reviewScale: null,
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      options.input = argv[++index];
      continue;
    }
    if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length);
      continue;
    }

    if (arg === "--output") {
      options.output = argv[++index];
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--snapshot-path") {
      options.snapshotPath = argv[++index];
      continue;
    }
    if (arg.startsWith("--snapshot-path=")) {
      options.snapshotPath = arg.slice("--snapshot-path=".length);
      continue;
    }

    if (arg === "--review-dir") {
      options.reviewDir = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-dir=")) {
      options.reviewDir = arg.slice("--review-dir=".length);
      continue;
    }

    if (arg === "--review-manifest") {
      options.reviewManifestPath = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-manifest=")) {
      options.reviewManifestPath = arg.slice("--review-manifest=".length);
      continue;
    }

    if (arg === "--review-scale") {
      options.reviewScale = argv[++index];
      continue;
    }
    if (arg.startsWith("--review-scale=")) {
      options.reviewScale = arg.slice("--review-scale=".length);
      continue;
    }

    if (arg === "--out") {
      options.out = argv[++index];
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
  }

  return options;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function collectAnswerGraphicReferences(inputPath) {
  const source = fs.readFileSync(inputPath, "utf8");
  const inputDir = path.dirname(inputPath);
  const references = [];
  const seen = new Set();
  const markerPattern = /<!--\s*answer-graphic:\s*(.+?)\s*-->/g;
  let match;

  while ((match = markerPattern.exec(source)) !== null) {
    const markerPath = match[1].trim();
    if (!markerPath || seen.has(markerPath)) {
      continue;
    }

    seen.add(markerPath);
    const placementPath = path.resolve(inputDir, markerPath);
    const placement = readJsonIfExists(placementPath);
    const previewPath = typeof placement?.previewPath === "string"
      ? path.resolve(path.dirname(placementPath), placement.previewPath)
      : null;

    const reference = {
      placementPath,
      ...(previewPath ? { previewPath } : {}),
      ...(typeof placement?.placedGraphicId === "string" ? { placedGraphicId: placement.placedGraphicId } : {}),
      ...(typeof placement?.graphicId === "string" ? { graphicId: placement.graphicId } : {}),
      ...(typeof placement?.artifactId === "string" ? { artifactId: placement.artifactId } : {}),
      ...(typeof placement?.questionRef === "string" ? { questionRef: placement.questionRef } : {}),
      ...(typeof placement?.placementMode === "string" ? { placementMode: placement.placementMode } : {})
    };

    references.push(reference);
  }

  return references;
}

function collectOcrMetadata(reviewManifestPath) {
  const reviewManifest = reviewManifestPath ? readJsonIfExists(reviewManifestPath) : null;
  const status = typeof reviewManifest?.ocrStatus === "string"
    ? reviewManifest.ocrStatus
    : "not-requested";
  const ocr = {
    status
  };

  if (typeof reviewManifest?.ocrProvider === "string") {
    ocr.provider = reviewManifest.ocrProvider;
  }

  if (typeof reviewManifest?.ocrProviderVersion === "string") {
    ocr.version = reviewManifest.ocrProviderVersion;
  }

  if (typeof reviewManifest?.ocrLanguage === "string") {
    ocr.language = reviewManifest.ocrLanguage;
  }

  if (Array.isArray(reviewManifest?.pages)) {
    ocr.pageCount = reviewManifest.pages.length;
  }

  if (typeof reviewManifest?.ocrError === "string") {
    ocr.error = reviewManifest.ocrError;
  }

  return ocr;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output || !options.snapshotPath) {
    fail("Missing required arguments for delivery manifest.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const inputPath = path.resolve(callerCwd, options.input);
  const outputPath = path.resolve(callerCwd, options.output);
  const snapshotPath = path.resolve(callerCwd, options.snapshotPath);
  const reviewDir = options.reviewDir ? path.resolve(callerCwd, options.reviewDir) : null;
  const reviewManifestPath = options.reviewManifestPath ? path.resolve(callerCwd, options.reviewManifestPath) : null;
  const manifestOutPath = options.out
    ? path.resolve(callerCwd, options.out)
    : path.resolve(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.delivery-manifest.json`);

  if (!fs.existsSync(snapshotPath)) {
    fail(`Resolved snapshot not found: ${snapshotPath}`);
  }

  let snapshot;
  try {
    snapshot = loadRequiredResolvedSnapshot(snapshotPath);
  } catch (error) {
    fail(error instanceof Error ? error.message : `Resolved snapshot is not valid JSON: ${snapshotPath}`);
  }

  const snapshotId = snapshot?.snapshotId;
  const snapshotProfile = snapshot?.activeProfile?.name;
  const snapshotSubjectPack = snapshot?.subjectPack?.assetId;
  const snapshotVersion = snapshot?.subjectPack?.version;
  if (typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
    fail(`Resolved snapshot is missing snapshotId: ${snapshotPath}`);
  }
  if (typeof snapshotProfile !== "string" || snapshotProfile.trim().length === 0) {
    fail(`Resolved snapshot is missing activeProfile.name: ${snapshotPath}`);
  }
  if (typeof snapshotSubjectPack !== "string" || snapshotSubjectPack.trim().length === 0) {
    fail(`Resolved snapshot is missing subjectPack.assetId: ${snapshotPath}`);
  }
  if (typeof snapshotVersion !== "string" || snapshotVersion.trim().length === 0) {
    fail(`Resolved snapshot is missing subjectPack.version: ${snapshotPath}`);
  }

  const reviewArtifactReady = Boolean(
    reviewDir
    && reviewManifestPath
    && fs.existsSync(reviewDir)
    && fs.existsSync(reviewManifestPath)
  );
  const deliveryComplete = fs.existsSync(outputPath);
  const answerGraphics = collectAnswerGraphicReferences(inputPath);
  const ocr = collectOcrMetadata(reviewManifestPath);
  const generatedAt = new Date().toISOString();
  const reviewLifecycleState = reviewArtifactReady ? "ready_for_review" : "draft";

  const manifest = {
    schemaVersion: "1.0",
    kind: "delivery-manifest",
    generatedAt,
    snapshotId,
    snapshotPath,
    snapshot: {
      id: snapshotId,
      version: snapshotVersion,
      profile: snapshotProfile
    },
    subjectPack: snapshotSubjectPack,
    profile: snapshotProfile,
    input: inputPath,
    output: outputPath,
    review: {
      outputDir: reviewDir,
      manifestPath: reviewManifestPath,
      scale: options.reviewScale,
      lifecycle: {
        state: reviewLifecycleState,
        updatedAt: generatedAt
      },
      feedbackRefs: []
    },
    ocr,
    graphics: {
      items: answerGraphics
    },
    status: {
      toolchainPassed: true,
      deliveryComplete,
      reviewArtifactReady,
      visualReviewPassed: null,
      trusted: false
    }
  };

  const errors = validateValueAgainstSchema(manifest, deliveryManifestSchemaPath);
  if (errors.length > 0) {
    fail(`Delivery manifest failed schema validation:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  fs.mkdirSync(path.dirname(manifestOutPath), { recursive: true });
  fs.writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(manifestOutPath);
}

main();
