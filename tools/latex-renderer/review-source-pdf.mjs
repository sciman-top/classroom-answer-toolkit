import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { analyzeAnalogMeterCanvas } from "./analog-meter-reading.mjs";
import { analyzeLinearScaleCanvas } from "./linear-scale-reading.mjs";
import { analyzeOpticalRayCanvas } from "./optical-ray-geometry.mjs";
import { resolveLocalBrowserPath } from "./browser-candidates.mjs";
import { loadFocusRegionSpec, resolveFocusRegionPixels } from "./focus-region-spec.mjs";
import { createRendererServer } from "./pdf-render-host.mjs";
import { getPageDimensionsInBrowser, loadPdfDocumentInBrowser, renderPdfPageInBrowser } from "./render-pdf-page.mjs";
import { parsePageSelection } from "./review-page-selection.mjs";
import { writeReviewHtml } from "./review-html.mjs";

const require = createRequire(import.meta.url);
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const tesseractPackageJson = require("tesseract.js/package.json");

const usage = `Usage:
  npm run review-source-pdf -- <input.pdf> [--out <dir>] [--pages all|1,3,5-7,last] [--scale 1.8] [--vertical-tiles 2] [--question-regions] [--horizontal-tiles 2] [--tile-overlap 0.15] [--focus-regions-file <regions.json>] [--ocr chi_sim]

Examples:
  npm run review-source-pdf -- "../../<试卷.pdf>"
  npm run review-source-pdf -- "../../<试卷.pdf>" --pages 1,last --scale 2
`;

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

// Kept as a hand-written parser: --ocr takes an optional value and --help
// short-circuits with the positional list, which the shared flag parser does
// not model.
function parseArgs(argv) {
  const positional = [];
  const options = {
    out: null,
    pages: "all",
    scale: 1.8,
    verticalTiles: 1,
    horizontalTiles: 1,
    questionRegions: false,
    tileOverlap: 0.15,
    focusRegionsFile: null,
    ocr: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true, positional, options };
    }

    if (arg === "--out") {
      options.out = requireValue(argv, ++index, arg);
      continue;
    }

    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--pages") {
      options.pages = requireValue(argv, ++index, arg);
      continue;
    }

    if (arg.startsWith("--pages=")) {
      options.pages = arg.slice("--pages=".length);
      continue;
    }

    if (arg === "--scale") {
      options.scale = Number(requireValue(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--scale=")) {
      options.scale = Number(arg.slice("--scale=".length));
      continue;
    }

    if (arg === "--vertical-tiles") {
      options.verticalTiles = Number(requireValue(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--vertical-tiles=")) {
      options.verticalTiles = Number(arg.slice("--vertical-tiles=".length));
      continue;
    }

    if (arg === "--horizontal-tiles") {
      options.horizontalTiles = Number(requireValue(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--horizontal-tiles=")) {
      options.horizontalTiles = Number(arg.slice("--horizontal-tiles=".length));
      continue;
    }

    if (arg === "--question-regions") {
      options.questionRegions = true;
      continue;
    }

    if (arg === "--tile-overlap") {
      options.tileOverlap = Number(requireValue(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--tile-overlap=")) {
      options.tileOverlap = Number(arg.slice("--tile-overlap=".length));
      continue;
    }

    if (arg === "--focus-regions-file") {
      options.focusRegionsFile = requireValue(argv, ++index, arg);
      continue;
    }

    if (arg.startsWith("--focus-regions-file=")) {
      options.focusRegionsFile = arg.slice("--focus-regions-file=".length);
      continue;
    }

    if (arg === "--ocr") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        options.ocr = next;
        index += 1;
      } else {
        options.ocr = "chi_sim";
      }
      continue;
    }

    if (arg.startsWith("--ocr=")) {
      options.ocr = arg.slice("--ocr=".length) || "chi_sim";
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    positional.push(arg);
  }

  return { help: false, positional, options };
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function makeDefaultOutputDir(inputPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(os.tmpdir(), "physics-source-pdf-review", `${baseName}-${stamp}`);
}

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    throw new Error("Invalid PNG data URL from browser renderer.");
  }

  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

async function runOcr({ manifest, language }) {
  const { createWorker } = await import("tesseract.js");
  const languages = language.split("+").map((item) => item.trim()).filter(Boolean);
  const cachePath = path.join(toolDir, ".tessdata");
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker(languages.length > 1 ? languages : languages[0], 1, {
    cachePath
  });

  try {
    for (const page of manifest.pages) {
      const result = await worker.recognize(page.imagePath);
      const text = result.data.text.trim();
      const textPath = page.imagePath.replace(/\.png$/i, ".ocr.txt");
      fs.writeFileSync(textPath, `${text}\n`, "utf8");
      page.ocrTextPath = textPath;
      page.ocrConfidence = result.data.confidence;
    }
  } finally {
    await worker.terminate();
  }
}

async function main() {
  const { help, positional, options } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage);
    return;
  }

  if (positional.length !== 1) {
    fail(usage);
  }

  if (!Number.isFinite(options.scale) || options.scale <= 0 || options.scale > 4) {
    fail("--scale must be a number greater than 0 and at most 4.");
  }
  if (!Number.isInteger(options.verticalTiles) || options.verticalTiles < 1 || options.verticalTiles > 4) {
    fail("--vertical-tiles must be an integer from 1 to 4.");
  }
  if (!Number.isInteger(options.horizontalTiles) || options.horizontalTiles < 1 || options.horizontalTiles > 3) {
    fail("--horizontal-tiles must be an integer from 1 to 3.");
  }
  if (options.questionRegions && options.verticalTiles !== 1) {
    fail("--question-regions cannot be combined with --vertical-tiles greater than 1.");
  }
  if (!Number.isFinite(options.tileOverlap) || options.tileOverlap < 0 || options.tileOverlap > 0.4) {
    fail("--tile-overlap must be a number from 0 to 0.4.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const inputPath = path.resolve(callerCwd, positional[0]);
  if (!fs.existsSync(inputPath)) {
    fail(`Input PDF not found: ${inputPath}`, 2);
  }
  const focusRegionSpec = options.focusRegionsFile
    ? loadFocusRegionSpec(path.resolve(callerCwd, options.focusRegionsFile), inputPath)
    : null;
  const focusScale = focusRegionSpec ? Math.min(8, options.scale * 2) : options.scale;

  const outputDir = options.out
    ? path.resolve(callerCwd, options.out)
    : makeDefaultOutputDir(inputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const browserPath = resolveLocalBrowserPath();
  const sharedBrowserWsEndpoint = process.env.CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT?.trim() || null;
  if (!sharedBrowserWsEndpoint && !browserPath) {
    fail("No local Chromium, Chrome, or Edge executable found for PDF source review.", 3);
  }

  const pdfJsPath = require.resolve("pdfjs-dist/build/pdf.mjs");
  const pdfWorkerPath = require.resolve("pdfjs-dist/build/pdf.worker.mjs");

  const manifest = {
    inputPath,
    outputDir,
    generatedAt: new Date().toISOString(),
    renderer: "pdfjs-dist + local Chrome/Edge via Playwright",
    browserPath: browserPath ?? "shared-browser-server",
    scale: options.scale,
    focusScale,
    verticalTiles: options.verticalTiles,
    horizontalTiles: options.horizontalTiles,
    questionRegions: options.questionRegions,
    tileOverlap: options.tileOverlap,
    focusRegionsFile: focusRegionSpec?.filePath ?? null,
    focusRegionsSha256: focusRegionSpec?.fileSha256 ?? null,
    focusRegionCount: focusRegionSpec?.regions.length ?? 0,
    requestedPages: options.pages,
    selectedPages: [],
    pageCount: 0,
    pages: [],
    ocrProvider: options.ocr ? "tesseract.js" : null,
    ocrProviderVersion: options.ocr ? tesseractPackageJson.version : null,
    ocrLanguage: options.ocr,
    ocrStatus: options.ocr ? "requested" : "not-requested"
  };

  let browser = null;
  let rendererServer = null;
  try {
    browser = sharedBrowserWsEndpoint
      ? await chromium.connect(sharedBrowserWsEndpoint)
      : await chromium.launch({
          executablePath: browserPath,
          headless: true
        });
    rendererServer = await createRendererServer({ pdfJsPath, pdfWorkerPath });

    const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        pageErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(rendererServer.url, { waitUntil: "load" });
    await page.waitForFunction(() => window.pdfReviewReady === true).catch((error) => {
      const details = pageErrors.length ? `\n${pageErrors.join("\n")}` : "";
      throw new Error(`PDF.js renderer did not initialize: ${error.message}${details}`);
    });

    const pdfData = fs.readFileSync(inputPath).toString("base64");
    const loaded = await page.evaluate(loadPdfDocumentInBrowser, { data: pdfData });

    manifest.pageCount = loaded.pageCount;
    manifest.fingerprint = loaded.fingerprint;
    manifest.selectedPages = parsePageSelection(options.pages, loaded.pageCount);

    const inputBase = path.basename(inputPath, path.extname(inputPath));
    let lastQuestionNumber = 0;
    for (const pageNumber of manifest.selectedPages) {
      const pageDimensions = await page.evaluate(getPageDimensionsInBrowser, {
        pageNumber,
        scale: options.scale,
        focusScale
      });
      const focusRegions = focusRegionSpec
        ? resolveFocusRegionPixels(
            focusRegionSpec,
            pageNumber,
            pageDimensions.focusWidth,
            pageDimensions.focusHeight
          )
        : [];
      const rendered = await page.evaluate(renderPdfPageInBrowser, {
        pageNumber,
        scale: options.scale,
        verticalTiles: options.verticalTiles,
        horizontalTiles: options.horizontalTiles,
        questionRegions: options.questionRegions,
        tileOverlap: options.tileOverlap,
        focusRenderScale: focusScale,
        focusRegions,
        previousQuestionNumber: lastQuestionNumber
      });
      for (const focusRegion of focusRegions.filter((region) => region.analogMeter)) {
        const analogMeterReading = await page.evaluate(analyzeAnalogMeterCanvas, {
          regionId: focusRegion.id,
          ...focusRegion.analogMeter
        });
        const tile = rendered.tiles.find((item) => item.focusRegionId === focusRegion.id);
        if (tile) {
          tile.analogMeterReading = analogMeterReading;
        }
      }
      for (const focusRegion of focusRegions.filter((region) => region.linearScale)) {
        const linearScaleReading = await page.evaluate(analyzeLinearScaleCanvas, {
          regionId: focusRegion.id,
          ...focusRegion.linearScale
        });
        const tile = rendered.tiles.find((item) => item.focusRegionId === focusRegion.id);
        if (tile) tile.linearScaleReading = linearScaleReading;
      }
      for (const focusRegion of focusRegions.filter((region) => region.opticalRay)) {
        const opticalRayGeometry = await page.evaluate(analyzeOpticalRayCanvas, {
          regionId: focusRegion.id,
          ...focusRegion.opticalRay
        });
        const tile = rendered.tiles.find((item) => item.focusRegionId === focusRegion.id);
        if (tile) tile.opticalRayGeometry = opticalRayGeometry;
      }
      lastQuestionNumber = rendered.detectedQuestionNumber;

      const pageLabel = String(pageNumber).padStart(3, "0");
      let textLayerPath = null;
      if (rendered.text) {
        textLayerPath = path.join(outputDir, `${inputBase}.page-${pageLabel}.text-layer.txt`);
        fs.mkdirSync(path.dirname(textLayerPath), { recursive: true });
        fs.writeFileSync(textLayerPath, `${rendered.text}\n`, "utf8");
      }

      for (const tile of rendered.tiles) {
        const questionSuffix = tile.questionNumber === null
          ? ""
          : `.q-${String(tile.questionNumber).padStart(3, "0")}`;
        const tileSuffix = tile.kind === "focus-region"
          ? `.focus-${String(tile.focusRegionIndex).padStart(2, "0")}.${tile.focusRegionId}`
          : options.verticalTiles === 1 && options.horizontalTiles === 1 && !options.questionRegions
            ? ""
            : `.tile-${String(tile.tileIndex).padStart(2, "0")}.x-${String(tile.horizontalIndex).padStart(2, "0")}`;
        const imagePath = path.join(outputDir, `${inputBase}.page-${pageLabel}${questionSuffix}${tileSuffix}.png`);
        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
        fs.writeFileSync(imagePath, dataUrlToBuffer(tile.dataUrl));
        manifest.pages.push({
          kind: tile.kind,
          pageNumber,
          questionNumber: tile.questionNumber,
          tileIndex: tile.tileIndex,
          tileCount: tile.tileCount,
          horizontalIndex: tile.horizontalIndex,
          horizontalTileCount: tile.horizontalTileCount,
          sourceY: tile.y,
          sourceX: tile.x,
          sourcePageWidth: tile.sourcePageWidth,
          sourcePageHeight: tile.sourcePageHeight,
          imagePath,
          width: tile.width,
          height: tile.height,
          focusRegionIndex: tile.focusRegionIndex,
          focusRegionId: tile.focusRegionId,
          focusLabel: tile.focusLabel,
          analogMeterReading: tile.analogMeterReading ?? null,
          linearScaleReading: tile.linearScaleReading ?? null,
          opticalRayGeometry: tile.opticalRayGeometry ?? null,
          textLayerPath,
          textLayerChars: rendered.text.length
        });
      }
    }
  } finally {
    // Close the browser first: Chromium pages hold idle keep-alive sockets, so
    // closing the HTTP server first would stall its callback until the browser's
    // own idle timeout elapses.
    if (browser) {
      await browser.close().catch(() => {});
    }
    try {
      rendererServer?.closeIdleConnections?.();
      if (rendererServer) {
        await rendererServer.close();
      }
    } catch {
      // Teardown is best effort; a failed close must not mask the run result.
    }
  }

  if (options.ocr) {
    try {
      await runOcr({ manifest, language: options.ocr });
      manifest.ocrStatus = "ok";
    } catch (error) {
      manifest.ocrStatus = "failed";
      manifest.ocrError = error instanceof Error ? error.message : String(error);
      console.error(`OCR failed: ${manifest.ocrError}`);
    }
  }

  const reviewHtmlPath = writeReviewHtml({ outputDir, inputPath, manifest });
  manifest.reviewHtmlPath = reviewHtmlPath;

  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Rendered ${manifest.pages.length} image(s) from ${manifest.selectedPages.length}/${manifest.pageCount} selected page(s).`);
  console.log(`Review HTML: ${reviewHtmlPath}`);
  console.log(`Manifest: ${manifestPath}`);
  if (manifest.ocrStatus === "ok") {
    console.log(`OCR: ${options.ocr}`);
  } else if (manifest.ocrStatus === "failed") {
    console.log("OCR: failed; page images were still generated.");
  } else {
    console.log("OCR: not requested.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
