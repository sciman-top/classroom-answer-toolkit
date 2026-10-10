import fs from "node:fs";
import path from "node:path";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { fail, parseArgvFlags, readJsonFileIfExists, repositoryRoot as repoRoot, sha256Hex } from "../shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { loadRequiredResolvedSnapshot } from "./lib/runtime-config.mjs";

const deliveryManifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: {
      input: true,
      output: true,
      "snapshot-path": "snapshotPath",
      "review-dir": "reviewDir",
      "review-manifest": "reviewManifestPath",
      "review-scale": "reviewScale",
      out: true
    },
    defaults: {
      input: null,
      output: null,
      snapshotPath: null,
      reviewDir: null,
      reviewManifestPath: null,
      reviewScale: null,
      out: null
    }
  });
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
    const placement = readJsonFileIfExists(placementPath);
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
  const reviewManifest = reviewManifestPath ? readJsonFileIfExists(reviewManifestPath) : null;
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

function createFileIntegrity(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes)
  };
}

function isPathWithin(directoryPath, filePath) {
  const relative = path.relative(directoryPath, filePath);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function copyPackageFile(sourcePath, targetPath, manifestDirectory) {
  if (!isPathWithin(manifestDirectory, targetPath)) {
    throw new Error(`Delivery graphic reference escapes the package directory: ${targetPath}`);
  }

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    if (sha256Hex(fs.readFileSync(targetPath)) !== sha256Hex(fs.readFileSync(sourcePath))) {
      throw new Error(`Delivery graphic resource collision with different content: ${targetPath}`);
    }
  } else {
    fs.copyFileSync(sourcePath, targetPath);
  }
  return true;
}

function packageAnswerGraphicReferences(inputPath, packagedInputPath, manifestDirectory) {
  const source = fs.readFileSync(inputPath, "utf8");
  const sourceInputDir = path.dirname(inputPath);
  const packagedInputDir = path.dirname(packagedInputPath);
  const markerPattern = /<!--\s*answer-graphic:\s*(.+?)\s*-->/g;
  const seen = new Set();
  let match;

  while ((match = markerPattern.exec(source)) !== null) {
    const markerPath = match[1].trim();
    if (!markerPath || seen.has(markerPath)) {
      continue;
    }

    seen.add(markerPath);
    const sourcePlacementPath = path.resolve(sourceInputDir, markerPath);
    const packagedPlacementPath = path.resolve(packagedInputDir, markerPath);
    copyPackageFile(sourcePlacementPath, packagedPlacementPath, manifestDirectory);

    const placement = readJsonFileIfExists(sourcePlacementPath);
    if (typeof placement?.previewPath !== "string" || placement.previewPath.trim().length === 0) {
      continue;
    }

    const sourcePreviewPath = path.resolve(path.dirname(sourcePlacementPath), placement.previewPath);
    const packagedPreviewPath = path.resolve(path.dirname(packagedPlacementPath), placement.previewPath);
    copyPackageFile(sourcePreviewPath, packagedPreviewPath, manifestDirectory);
  }
}

function ensureInputInDeliveryPackage(inputPath, manifestDirectory) {
  const relative = path.relative(manifestDirectory, inputPath);
  if (!path.isAbsolute(relative) && !relative.startsWith("..")) {
    return inputPath;
  }

  const extension = path.extname(inputPath);
  const baseName = path.basename(inputPath, extension);
  const packagedPath = path.join(manifestDirectory, `${baseName}.delivery-input${extension}`);
  if (fs.existsSync(packagedPath)) {
    if (sha256Hex(fs.readFileSync(packagedPath)) !== sha256Hex(fs.readFileSync(inputPath))) {
      throw new Error(`Delivery input copy already exists with different content: ${packagedPath}`);
    }
  } else {
    fs.copyFileSync(inputPath, packagedPath);
  }

  packageAnswerGraphicReferences(inputPath, packagedPath, manifestDirectory);
  return packagedPath;
}

function collectReviewFilePaths(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
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

  for (const [label, filePath] of [
    ["Answer Markdown", inputPath],
    ["Rendered PDF", outputPath],
    ["Resolved snapshot", snapshotPath]
  ]) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      fail(`${label} not found: ${filePath}`);
    }
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
  const manifestDirectory = path.dirname(manifestOutPath);
  // Package-internal paths are relative to the manifest directory so an
  // archived delivery validates after the archive moves or changes machine.
  const anchoredPath = (filePath) => {
    const relative = path.relative(manifestDirectory, filePath);
    return relative.startsWith("..") ? filePath : relative.split(path.sep).join("/");
  };
  const packagedInputPath = ensureInputInDeliveryPackage(inputPath, manifestDirectory);
  const answerGraphics = collectAnswerGraphicReferences(packagedInputPath)
    .map((reference) => ({
      ...reference,
      placementPath: anchoredPath(reference.placementPath),
      ...(reference.previewPath ? { previewPath: anchoredPath(reference.previewPath) } : {})
    }));
  const ocr = collectOcrMetadata(reviewManifestPath);
  const generatedAt = new Date().toISOString();

  // The review set is delivery-owned (<pdf-base>.review beside the PDF), so
  // its integrity entries follow the same anchor — leaving them absolute broke
  // validation for any relocated archive (2026-08-27 closeout regression).
  const reviewFiles = reviewArtifactReady
    ? collectReviewFilePaths(reviewDir).map((filePath) => ({
      ...createFileIntegrity(filePath),
      path: anchoredPath(filePath)
    }))
    : [];

  const manifest = {
    schemaVersion: "1.1",
    kind: "delivery-manifest",
    generatedAt,
    snapshotId,
    snapshotPath: anchoredPath(snapshotPath),
    snapshot: {
      id: snapshotId,
      version: snapshotVersion,
      profile: snapshotProfile
    },
    subjectPack: snapshotSubjectPack,
    profile: snapshotProfile,
    input: anchoredPath(packagedInputPath),
    output: anchoredPath(outputPath),
    review: {
      outputDir: reviewArtifactReady ? anchoredPath(reviewDir) : "",
      manifestPath: reviewArtifactReady ? anchoredPath(reviewManifestPath) : "",
      scale: options.reviewScale ?? ""
    },
    ocr,
    graphics: {
      items: answerGraphics
    },
    integrity: {
      algorithm: "sha256",
      input: { ...createFileIntegrity(packagedInputPath), path: anchoredPath(packagedInputPath) },
      output: { ...createFileIntegrity(outputPath), path: anchoredPath(outputPath) },
      snapshot: { ...createFileIntegrity(snapshotPath), path: anchoredPath(snapshotPath) },
      reviewFiles
    },
    status: {
      toolchainPassed: true,
      deliveryComplete,
      reviewArtifactReady
    }
  };

  const errors = validateValueAgainstSchema(manifest, deliveryManifestSchemaPath);
  if (errors.length > 0) {
    fail(`Delivery manifest failed schema validation:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }

  fs.mkdirSync(path.dirname(manifestOutPath), { recursive: true });
  writeTextFileAtomic(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestOutPath);
}

try {
  main();
} catch (error) {
  // Keep the gate failing, but report like fail() does instead of a raw stack.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
