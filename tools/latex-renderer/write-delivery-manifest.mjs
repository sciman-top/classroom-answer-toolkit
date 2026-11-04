import fs from "node:fs";
import path from "node:path";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { fail, isDirectInvocation, parseArgvFlags, readJsonFileIfExists, repositoryRoot as repoRoot, sha256Hex } from "../shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";
import { loadRequiredResolvedSnapshot } from "./lib/runtime-config.mjs";
import { writeReviewHtml } from "./lib/review-html.mjs";

const deliveryManifestSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "delivery-manifest.schema.json");

export function writeDeliveryManifest({
  inputPath,
  outputPath,
  snapshotPath,
  reviewDirectory,
  reviewManifestPath,
  reviewScale,
  manifestPath
}) {
  return writeDeliveryManifestCore({
    inputPath: path.resolve(inputPath),
    outputPath: path.resolve(outputPath),
    snapshotPath: path.resolve(snapshotPath),
    reviewDir: reviewDirectory ? path.resolve(reviewDirectory) : null,
    reviewManifestPath: reviewManifestPath ? path.resolve(reviewManifestPath) : null,
    reviewScale: reviewScale ?? null,
    manifestOutPath: path.resolve(manifestPath)
  });
}

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

function readReviewSourceManifest(reviewDirectory, declaredManifestPath) {
  if (!reviewDirectory || !declaredManifestPath) {
    return null;
  }
  const candidates = [
    declaredManifestPath,
    path.join(reviewDirectory, "manifest.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const value = readJsonFileIfExists(candidate);
      if (value?.kind === "pdf-source-review") {
        return value;
      }
    }
  }
  return null;
}

function isPathWithin(directoryPath, filePath) {
  const relative = path.relative(directoryPath, filePath);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function copyPackageFile(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  if (!fs.statSync(sourcePath).isFile()) {
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
    // A newly packaged answer is already anchored at the delivery directory;
    // preserve its marker path. Rewriting the same external path beside the
    // packaged Markdown would make the Markdown point to a different directory.
    const packagedPlacementPath = path.resolve(manifestDirectory, markerPath);
    copyPackageFile(sourcePlacementPath, packagedPlacementPath);

    const placement = readJsonFileIfExists(sourcePlacementPath);
    const previewPath = typeof placement?.previewPath === "string"
      ? path.resolve(path.dirname(sourcePlacementPath), placement.previewPath)
      : null;
    if (previewPath) {
      const packagedPreviewPath = path.resolve(path.dirname(packagedPlacementPath), placement.previewPath);
      copyPackageFile(previewPath, packagedPreviewPath);
    }
  }
}

function ensureInputInDeliveryPackage(inputPath, manifestDirectory, reservedPaths) {
  const relative = path.relative(manifestDirectory, inputPath);
  if (!path.isAbsolute(relative) && !relative.startsWith("..")) {
    return inputPath;
  }

  const extension = path.extname(inputPath);
  const baseName = path.basename(inputPath, extension);
  let packagedPath = path.join(manifestDirectory, `${baseName}.delivery-input${extension}`);
  if (reservedPaths.has(path.normalize(packagedPath))) {
    throw new Error(`Delivery input copy would overwrite a delivery artifact: ${packagedPath}`);
  }
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
      if (entry.isSymbolicLink()) {
        throw new Error(`Delivery review package contains a reparse point: ${entryPath}`);
      }
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

function collectReviewSourcePaths(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return [];
  }
  const paths = [];
  const visit = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
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

function writeDeliveryManifestCore({
  inputPath,
  outputPath,
  snapshotPath,
  reviewDir,
  reviewManifestPath,
  reviewScale,
  manifestOutPath
}) {
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

  const sourceReviewManifest = readReviewSourceManifest(reviewDir, reviewManifestPath);
  let reviewArtifactReady = Boolean(
    reviewDir
    && reviewManifestPath
    && fs.existsSync(reviewDir)
    && fs.existsSync(reviewManifestPath)
    && sourceReviewManifest?.kind === "pdf-source-review"
    && sourceReviewManifest.inputSha256 === createFileIntegrity(outputPath).sha256
    && Array.isArray(sourceReviewManifest.selectedPages)
    && sourceReviewManifest.selectedPages.length === sourceReviewManifest.pageCount
    && Array.isArray(sourceReviewManifest.pages)
    && sourceReviewManifest.pages.length > 0
  );
  const manifestDirectory = path.dirname(manifestOutPath);
  // Package-internal paths are relative to the manifest directory so an
  // archived delivery validates after the archive moves or changes machine.
  const anchoredPath = (filePath) => {
    const relative = path.relative(manifestDirectory, filePath);
    const contained = relative === ""
      || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
    return contained ? relative.split(path.sep).join("/") : filePath;
  };
  if (reviewArtifactReady) {
    // Delivery-owned review JSON must not retain development-cache absolute
    // paths. Copy it beside the PDF, then rewrite the PDF/image references
    // relative to its package before hashing either file.
    const packagedReviewDirectory = path.join(
      manifestDirectory,
      `${path.basename(outputPath, path.extname(outputPath))}.review`
    );
    const declaredReviewManifestPath = reviewManifestPath;
    const cachedSourceFiles = collectReviewSourcePaths(path.dirname(declaredReviewManifestPath));
    const sourceDeliveryReviewIsCurrent = fs.existsSync(packagedReviewDirectory)
      && declaredReviewManifestPath
      && path.resolve(path.dirname(declaredReviewManifestPath)) === path.resolve(packagedReviewDirectory);
    const sourceReviewFile = readReviewSourceManifest(
      sourceDeliveryReviewIsCurrent ? reviewDir : path.dirname(declaredReviewManifestPath),
      declaredReviewManifestPath
    );
    const sourceReviewDirectory = sourceReviewFile?.outputDir
      ? path.resolve(sourceReviewFile.outputDir)
      : path.dirname(declaredReviewManifestPath);
    const packagedReviewManifestPath = path.join(packagedReviewDirectory, "manifest.json");
    if (path.resolve(reviewDir) === path.resolve(packagedReviewDirectory)
        && !fs.existsSync(path.join(packagedReviewDirectory, "manifest.json"))) {
      throw new Error(`Existing delivery review package lacks manifest.json: ${packagedReviewDirectory}`);
    }
    if (path.resolve(reviewDir) !== path.resolve(packagedReviewDirectory)) {
      fs.cpSync(reviewDir, packagedReviewDirectory, { recursive: true, force: true });
    }
    if (!fs.existsSync(packagedReviewManifestPath)) {
      throw new Error(`Delivery review package did not include its manifest: ${packagedReviewManifestPath}`);
    }
    const packagedReview = readJsonFileIfExists(packagedReviewManifestPath);
    if (sourceReviewFile && packagedReview) {
      packagedReview.pages = structuredClone(sourceReviewFile.pages ?? []);
    }
    for (const page of packagedReview?.pages ?? []) {
      const cachedPage = packagedReview?.pages?.find((candidate) =>
        candidate?.pageNumber === page?.pageNumber
        && candidate?.kind === page?.kind
        && candidate?.horizontalIndex === page?.horizontalIndex
      );
      const sourcePage = sourceDeliveryReviewIsCurrent ? null : sourceReviewFile?.pages?.find((candidate) =>
        candidate?.pageNumber === page?.pageNumber
        && candidate?.kind === page?.kind
        && candidate?.horizontalIndex === page?.horizontalIndex
      );
      const declaredImagePath = sourcePage?.imagePath ?? cachedPage?.imagePath;
      const sourceImagePath = typeof declaredImagePath === "string"
        ? (path.isAbsolute(declaredImagePath)
            ? declaredImagePath
            : path.resolve(sourceReviewDirectory, declaredImagePath))
        : null;
      const absoluteImagePath = sourceImagePath && fs.existsSync(sourceImagePath)
        ? sourceImagePath
        : path.resolve(packagedReviewDirectory, path.basename(sourceImagePath ?? ""));
      const relativeImagePath = absoluteImagePath
        ? path.relative(packagedReviewDirectory, absoluteImagePath)
        : "";
      const cachedImagePath = cachedSourceFiles.find((filePath) =>
        path.basename(filePath) === path.basename(declaredImagePath ?? "")
      );
      const absoluteRatio = path.isAbsolute(sourceImagePath ?? "")
        ? path.join(
            path.basename(path.dirname(sourceImagePath)),
            path.basename(sourceImagePath)
          )
        : sourceImagePath === null && page.imagePath
          ? path.basename(page.imagePath)
          : sourceImagePath;
      const safeRelativeImagePath = absoluteRatio.startsWith("..") || !absoluteRatio
        ? (cachedImagePath ? path.basename(cachedImagePath) : "")
        : absoluteRatio;
      if (!safeRelativeImagePath || path.isAbsolute(safeRelativeImagePath)) {
        throw new Error(`Review page image is outside its package: ${page.imagePath ?? "<missing>"}`);
      }
      // Review page images are recorded as absolute paths on purpose: the
      // review HTML and validators resolve them against the packaged review
      // directory today. Moving a delivery directory to another machine
      // therefore relocates the whole folder as one unit; the delivery
      // manifest itself (input/output/snapshot/integrity) stays package-
      // relative and keeps validating after an archive move.
      page.imagePath = cachedImagePath ?? path.resolve(packagedReviewDirectory, path.basename(safeRelativeImagePath));
      if (page.kind === "page-tile" && (sourcePage?.textLayerPath ?? page.textLayerPath)) {
        page.textLayerPath = fs.existsSync(path.resolve(
          packagedReviewDirectory,
          path.basename(sourcePage?.textLayerPath ?? page.textLayerPath)
        ))
          ? path.resolve(packagedReviewDirectory, path.basename(sourcePage?.textLayerPath ?? page.textLayerPath))
          : null;
      }
    }
    if (packagedReview) {
      packagedReview.inputPath = path.relative(packagedReviewDirectory, outputPath);
      packagedReview.outputDir = packagedReviewDirectory;
      packagedReview.reviewHtmlPath = path.join(path.dirname(packagedReviewManifestPath), "review.html");
      writeTextFileAtomic(packagedReviewManifestPath, `${JSON.stringify(packagedReview, null, 2)}\n`);
      writeReviewHtml({
        outputDir: path.dirname(packagedReviewManifestPath),
        inputPath: outputPath,
        manifest: packagedReview
      });
      reviewDir = packagedReviewDirectory;
      reviewManifestPath = packagedReviewManifestPath;
      reviewArtifactReady = true;
    }
  }
  const deliveryComplete = fs.existsSync(outputPath);
  if (reviewArtifactReady
      && path.resolve(reviewManifestPath) !== path.resolve(
        manifestDirectory,
        `${path.basename(outputPath, path.extname(outputPath))}.review`,
        "manifest.json"
      )) {
    throw new Error(`Delivery review must be anchored beside its PDF: ${reviewManifestPath}`);
  }
  const packagedInputPath = ensureInputInDeliveryPackage(inputPath, manifestDirectory, new Set([
    path.normalize(outputPath),
    path.normalize(snapshotPath),
    path.normalize(manifestOutPath)
  ]));
  const answerGraphics = collectAnswerGraphicReferences(packagedInputPath)
    .map((reference) => ({
      ...reference,
      placementPath: anchoredPath(reference.placementPath),
      ...(reference.previewPath ? { previewPath: anchoredPath(reference.previewPath) } : {})
    }));
  const ocr = collectOcrMetadata(reviewArtifactReady ? reviewManifestPath : null);
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
      scale: reviewScale ?? ""
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

  fs.mkdirSync(path.dirname(manifestOutPath), { recursive: true });
  writeTextFileAtomic(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return errors;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input || !options.output || !options.snapshotPath) {
    fail("Missing required arguments for delivery manifest.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const outputPath = path.resolve(callerCwd, options.output);
  const manifestOutPath = options.out
    ? path.resolve(callerCwd, options.out)
    : path.resolve(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.delivery-manifest.json`);
  const errors = writeDeliveryManifest({
    inputPath: path.resolve(callerCwd, options.input),
    outputPath,
    snapshotPath: path.resolve(callerCwd, options.snapshotPath),
    reviewDirectory: options.reviewDir ? path.resolve(callerCwd, options.reviewDir) : null,
    reviewManifestPath: options.reviewManifestPath ? path.resolve(callerCwd, options.reviewManifestPath) : null,
    reviewScale: options.reviewScale,
    manifestPath: manifestOutPath
  });
  // The manifest is written before this schema check on purpose: a schema
  // failure still leaves the paid delivery record on disk for diagnostics,
  // and every downstream consumer re-validates before trusting it.
  if (errors.length > 0) {
    fail(`Delivery manifest failed schema validation:\n${errors.map((error) => `- ${error}`).join("\n")}`, 1);
  }
  console.log(manifestOutPath);
}

if (isDirectInvocation(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Keep the gate failing, but report like fail() does instead of a raw stack.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
