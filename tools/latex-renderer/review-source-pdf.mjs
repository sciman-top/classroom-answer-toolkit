import fs from "node:fs";
import http from "node:http";
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

const require = createRequire(import.meta.url);
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const tesseractPackageJson = require("tesseract.js/package.json");
const restrictedPorts = new Set([
  0,
  1,
  7,
  9,
  11,
  13,
  15,
  17,
  19,
  20,
  21,
  22,
  23,
  25,
  37,
  42,
  43,
  53,
  69,
  77,
  79,
  87,
  95,
  101,
  102,
  103,
  104,
  109,
  110,
  111,
  113,
  115,
  117,
  119,
  123,
  135,
  137,
  139,
  143,
  161,
  179,
  389,
  427,
  465,
  512,
  513,
  514,
  515,
  526,
  530,
  531,
  532,
  540,
  548,
  554,
  556,
  563,
  587,
  601,
  636,
  989,
  990,
  993,
  995,
  1719,
  1720,
  1723,
  2049,
  3659,
  4045,
  5060,
  5061,
  6000,
  6566,
  6665,
  6666,
  6667,
  6668,
  6669,
  6697,
  10080
]);

const usage = `Usage:
  npm run review-source-pdf -- <input.pdf> [--out <dir>] [--pages all|1,3,5-7,last] [--scale 1.8] [--vertical-tiles 2] [--question-regions] [--horizontal-tiles 2] [--tile-overlap 0.15] [--focus-regions-file <regions.json>] [--ocr chi_sim]

Examples:
  npm run review-source-pdf -- "../../样例交付/能量-效率.pdf"
  npm run review-source-pdf -- "../../样例交付/能量-效率.pdf" --pages 1,last --scale 2
  npm run review-source-pdf -- "../../样例交付/能量-效率.pdf" --pages 1 --ocr chi_sim
`;

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

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

function normalizePageToken(token, pageCount) {
  if (token === "last") {
    return pageCount;
  }

  const pageNumber = Number(token);
  if (!Number.isInteger(pageNumber)) {
    throw new Error(`Invalid page token: ${token}`);
  }

  return pageNumber;
}

function parsePageSelection(selection, pageCount) {
  if (!selection || selection.toLowerCase() === "all") {
    return Array.from({ length: pageCount }, (_value, index) => index + 1);
  }

  const selected = [];
  const seen = new Set();
  const tokens = selection.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);

  for (const token of tokens) {
    if (token.includes("-")) {
      const [startToken, endToken] = token.split("-", 2);
      const start = normalizePageToken(startToken, pageCount);
      const end = normalizePageToken(endToken, pageCount);
      if (start > end) {
        throw new Error(`Invalid page range: ${token}`);
      }

      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        if (!seen.has(pageNumber)) {
          selected.push(pageNumber);
          seen.add(pageNumber);
        }
      }
      continue;
    }

    const pageNumber = normalizePageToken(token, pageCount);
    if (!seen.has(pageNumber)) {
      selected.push(pageNumber);
      seen.add(pageNumber);
    }
  }

  for (const pageNumber of selected) {
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${pageNumber} is outside 1-${pageCount}`);
    }
  }

  return selected;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeReviewHtml({ outputDir, inputPath, manifest }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const imageItems = manifest.pages.map((page) => {
    const imageName = path.basename(page.imagePath);
    const heading = page.kind === "focus-region"
      ? `Page ${page.pageNumber} focus: ${escapeHtml(page.focusLabel)}`
      : `Page ${page.pageNumber}`;
    const textLayer = page.textLayerPath
      ? `<a href="${escapeHtml(path.basename(page.textLayerPath))}">text layer</a>`
      : "no text layer";
    const ocr = page.ocrTextPath
      ? ` · <a href="${escapeHtml(path.basename(page.ocrTextPath))}">ocr</a>`
      : "";

    return `<section>
  <h2>${heading}</h2>
  <p>${page.width} x ${page.height}px · ${textLayer}${ocr}</p>
  <img src="${escapeHtml(imageName)}" alt="Page ${page.pageNumber}">
</section>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>PDF source review</title>
<style>
body {
  margin: 24px;
  background: #f4f4f4;
  color: #1f1f1f;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
}
header,
section {
  max-width: 980px;
  margin: 0 auto 24px;
}
h1 {
  font-size: 22px;
  margin: 0 0 8px;
}
h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
p {
  margin: 0 0 10px;
  color: #555;
}
img {
  display: block;
  width: 100%;
  height: auto;
  background: white;
  border: 1px solid #d8d8d8;
}
</style>
</head>
<body>
<header>
  <h1>PDF source review</h1>
  <p>${escapeHtml(inputPath)}</p>
  <p>Renderer: ${escapeHtml(manifest.renderer)} · pages: ${manifest.selectedPages.join(", ")}</p>
</header>
${imageItems}
</body>
</html>`;

  const htmlPath = path.join(outputDir, "review.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function createRendererServer({ pdfJsPath, pdfWorkerPath }) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module">
import * as pdfjsLib from "/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
window.pdfReview = { pdfjsLib };
window.pdfReviewReady = true;
</script>
</body>
</html>`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/" || url.pathname === "/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      if (url.pathname === "/pdf.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        fs.createReadStream(pdfJsPath).pipe(response);
        return;
      }

      if (url.pathname === "/pdf.worker.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        fs.createReadStream(pdfWorkerPath).pipe(response);
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start local PDF.js renderer server.");
    }

    if (restrictedPorts.has(address.port)) {
      await new Promise((resolve) => server.close(resolve));
      continue;
    }

    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: () => new Promise((resolve) => server.close(resolve))
    };
  }

  throw new Error("Unable to start local PDF.js renderer server on an allowed port.");
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
    const loaded = await page.evaluate(async ({ data }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const loadingTask = window.pdfReview.pdfjsLib.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      window.pdfReview.document = pdf;
      return {
        pageCount: pdf.numPages,
        fingerprint: pdf.fingerprints?.[0] ?? null
      };
    }, { data: pdfData });

    manifest.pageCount = loaded.pageCount;
    manifest.fingerprint = loaded.fingerprint;
    manifest.selectedPages = parsePageSelection(options.pages, loaded.pageCount);

    const inputBase = path.basename(inputPath, path.extname(inputPath));
    let lastQuestionNumber = 0;
    for (const pageNumber of manifest.selectedPages) {
      const pageDimensions = await page.evaluate(async ({ pageNumber: pageNo, scale, focusScale: focusedScale }) => {
        const pdfPage = await window.pdfReview.document.getPage(pageNo);
        const viewport = pdfPage.getViewport({ scale });
        const focusViewport = pdfPage.getViewport({ scale: focusedScale });
        return {
          width: Math.ceil(viewport.width),
          height: Math.ceil(viewport.height),
          focusWidth: Math.ceil(focusViewport.width),
          focusHeight: Math.ceil(focusViewport.height)
        };
      }, { pageNumber, scale: options.scale, focusScale });
      const focusRegions = focusRegionSpec
        ? resolveFocusRegionPixels(
            focusRegionSpec,
            pageNumber,
            pageDimensions.focusWidth,
            pageDimensions.focusHeight
          )
        : [];
      const rendered = await page.evaluate(async ({
        pageNumber: pageNo,
        scale,
        verticalTiles,
        horizontalTiles,
        questionRegions,
        tileOverlap,
        focusRenderScale,
        focusRegions,
        previousQuestionNumber
      }) => {
        const pdfPage = await window.pdfReview.document.getPage(pageNo);
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;

        const textContent = await pdfPage.getTextContent().catch(() => ({ items: [] }));
        const text = textContent.items.map((item) => item.str).join("").trim();

        const markerCandidates = textContent.items
          .map((item) => {
            const match = String(item.str ?? "").trim().match(/^(\d{1,2})\.$/u);
            if (!match || Number(item.transform?.[4]) > 90) {
              return null;
            }
            const viewportPoint = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
            return { number: Number(match[1]), y: viewportPoint[1] };
          })
          .filter(Boolean)
          .sort((left, right) => left.y - right.y);
        const questionMarkers = [];
        let detectedQuestionNumber = previousQuestionNumber;
        for (const candidate of markerCandidates) {
          const continuesPrevious = questionMarkers.length === 0
            && candidate.number === detectedQuestionNumber;
          if (continuesPrevious || candidate.number === detectedQuestionNumber + 1) {
            questionMarkers.push(candidate);
            detectedQuestionNumber = Math.max(detectedQuestionNumber, candidate.number);
          }
        }

        const regions = [];
        if (questionRegions) {
          const margin = Math.max(24, Math.round(16 * scale));
          if (questionMarkers.length === 0) {
            regions.push({ questionNumber: detectedQuestionNumber || null, y: 0, endY: canvas.height });
          } else {
            const firstStart = Math.max(0, Math.floor(questionMarkers[0].y - margin));
            if (firstStart > margin && previousQuestionNumber > 0
                && questionMarkers[0].number > previousQuestionNumber) {
              regions.push({ questionNumber: previousQuestionNumber, y: 0, endY: firstStart });
            }
            for (let index = 0; index < questionMarkers.length; index += 1) {
              const marker = questionMarkers[index];
              const y = Math.max(0, Math.floor(marker.y - margin));
              const endY = index + 1 < questionMarkers.length
                ? Math.max(y + 1, Math.floor(questionMarkers[index + 1].y - margin))
                : canvas.height;
              regions.push({ questionNumber: marker.number, y, endY });
            }
          }
        } else {
          const baseTileHeight = canvas.height / verticalTiles;
          const overlapPixels = baseTileHeight * tileOverlap;
          for (let tileIndex = 0; tileIndex < verticalTiles; tileIndex += 1) {
            const y = Math.max(0, Math.floor(tileIndex * baseTileHeight - overlapPixels));
            const endY = Math.min(canvas.height, Math.ceil((tileIndex + 1) * baseTileHeight + overlapPixels));
            regions.push({ questionNumber: null, y, endY });
          }
        }

        const tiles = [];
        for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
          const region = regions[regionIndex];
          const baseTileWidth = canvas.width / horizontalTiles;
          const horizontalOverlapPixels = baseTileWidth * tileOverlap;
          for (let horizontalIndex = 0; horizontalIndex < horizontalTiles; horizontalIndex += 1) {
            const x = Math.max(0, Math.floor(horizontalIndex * baseTileWidth - horizontalOverlapPixels));
            const endX = Math.min(canvas.width, Math.ceil((horizontalIndex + 1) * baseTileWidth + horizontalOverlapPixels));
            const y = region.y;
            const endY = region.endY;
            const tileCanvas = document.createElement("canvas");
            tileCanvas.width = endX - x;
            tileCanvas.height = endY - y;
            const tileContext = tileCanvas.getContext("2d", { alpha: false });
            tileContext.fillStyle = "white";
            tileContext.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
            tileContext.drawImage(
              canvas,
              x,
              y,
              tileCanvas.width,
              tileCanvas.height,
              0,
              0,
              tileCanvas.width,
              tileCanvas.height
            );
            tiles.push({
              kind: "page-tile",
              dataUrl: tileCanvas.toDataURL("image/png"),
              tileIndex: regionIndex + 1,
              tileCount: regions.length,
              horizontalIndex: horizontalIndex + 1,
              horizontalTileCount: horizontalTiles,
              questionNumber: region.questionNumber,
              x,
              y,
              width: tileCanvas.width,
              height: tileCanvas.height,
              sourcePageWidth: canvas.width,
              sourcePageHeight: canvas.height,
              focusRegionIndex: null,
              focusRegionId: null,
              focusLabel: null
            });
          }
        }

        let focusSourceCanvas = canvas;
        if (focusRegions.length > 0 && focusRenderScale !== scale) {
          const focusViewport = pdfPage.getViewport({ scale: focusRenderScale });
          focusSourceCanvas = document.createElement("canvas");
          focusSourceCanvas.width = Math.ceil(focusViewport.width);
          focusSourceCanvas.height = Math.ceil(focusViewport.height);
          const focusSourceContext = focusSourceCanvas.getContext("2d", { alpha: false });
          focusSourceContext.fillStyle = "white";
          focusSourceContext.fillRect(0, 0, focusSourceCanvas.width, focusSourceCanvas.height);
          await pdfPage.render({ canvasContext: focusSourceContext, viewport: focusViewport }).promise;
        }

        window.pdfReview.focusCanvases = window.pdfReview.focusCanvases ?? {};
        for (const focusRegion of focusRegions) {
          const focusCanvas = document.createElement("canvas");
          focusCanvas.width = focusRegion.width;
          focusCanvas.height = focusRegion.height;
          const focusContext = focusCanvas.getContext("2d", { alpha: false });
          focusContext.fillStyle = "white";
          focusContext.fillRect(0, 0, focusCanvas.width, focusCanvas.height);
          focusContext.drawImage(
            focusSourceCanvas,
            focusRegion.x,
            focusRegion.y,
            focusRegion.width,
            focusRegion.height,
            0,
            0,
            focusRegion.width,
            focusRegion.height
          );
          window.pdfReview.focusCanvases[focusRegion.id] = focusCanvas;
          tiles.push({
            kind: "focus-region",
            dataUrl: focusCanvas.toDataURL("image/png"),
            tileIndex: null,
            tileCount: null,
            horizontalIndex: null,
            horizontalTileCount: null,
            questionNumber: focusRegion.questionNumber,
            x: focusRegion.x,
            y: focusRegion.y,
            width: focusRegion.width,
            height: focusRegion.height,
            sourcePageWidth: focusSourceCanvas.width,
            sourcePageHeight: focusSourceCanvas.height,
            focusRegionIndex: focusRegion.focusRegionIndex,
            focusRegionId: focusRegion.id,
            focusLabel: focusRegion.label
          });
        }

        return {
          width: canvas.width,
          height: canvas.height,
          text,
          tiles,
          detectedQuestionNumber
        };
      }, {
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
    try {
      if (rendererServer) {
        await rendererServer.close();
      }
    } finally {
      if (browser) {
        await browser.close();
      }
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
