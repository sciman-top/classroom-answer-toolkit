import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const toolDir = path.dirname(fileURLToPath(import.meta.url));

const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const usage = `Usage:
  npm run review-source-pdf -- <input.pdf> [--out <dir>] [--pages all|1,3,5-7,last] [--scale 1.8] [--ocr chi_sim]

Examples:
  npm run review-source-pdf -- "../../习题PDF/能量-效率.pdf"
  npm run review-source-pdf -- "../../习题PDF/能量-效率.pdf" --pages 1,last --scale 2
  npm run review-source-pdf -- "../../习题PDF/能量-效率.pdf" --pages 1 --ocr chi_sim
`;

function parseArgs(argv) {
  const positional = [];
  const options = {
    out: null,
    pages: "all",
    scale: 1.8,
    ocr: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true, positional, options };
    }

    if (arg === "--out") {
      options.out = argv[++index];
      continue;
    }

    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--pages") {
      options.pages = argv[++index];
      continue;
    }

    if (arg.startsWith("--pages=")) {
      options.pages = arg.slice("--pages=".length);
      continue;
    }

    if (arg === "--scale") {
      options.scale = Number(argv[++index]);
      continue;
    }

    if (arg.startsWith("--scale=")) {
      options.scale = Number(arg.slice("--scale=".length));
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
  const imageItems = manifest.pages.map((page) => {
    const imageName = path.basename(page.imagePath);
    const textLayer = page.textLayerPath
      ? `<a href="${escapeHtml(path.basename(page.textLayerPath))}">text layer</a>`
      : "no text layer";
    const ocr = page.ocrTextPath
      ? ` · <a href="${escapeHtml(path.basename(page.ocrTextPath))}">ocr</a>`
      : "";

    return `<section>
  <h2>Page ${page.pageNumber}</h2>
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

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
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

  if (!positional[0]) {
    fail(usage);
  }

  if (!Number.isFinite(options.scale) || options.scale <= 0 || options.scale > 4) {
    fail("--scale must be a number greater than 0 and at most 4.");
  }

  const callerCwd = process.env.INIT_CWD || process.cwd();
  const inputPath = path.resolve(callerCwd, positional[0]);
  if (!fs.existsSync(inputPath)) {
    fail(`Input PDF not found: ${inputPath}`, 2);
  }

  const outputDir = options.out
    ? path.resolve(callerCwd, options.out)
    : makeDefaultOutputDir(inputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    fail("No local Chrome or Edge executable found for PDF source review.", 3);
  }

  const pdfJsPath = require.resolve("pdfjs-dist/build/pdf.mjs");
  const pdfWorkerPath = require.resolve("pdfjs-dist/build/pdf.worker.mjs");

  const manifest = {
    inputPath,
    outputDir,
    generatedAt: new Date().toISOString(),
    renderer: "pdfjs-dist + local Chrome/Edge via Playwright",
    browserPath,
    scale: options.scale,
    requestedPages: options.pages,
    selectedPages: [],
    pageCount: 0,
    pages: [],
    ocrLanguage: options.ocr,
    ocrStatus: options.ocr ? "requested" : "not-requested"
  };

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true
  });
  const rendererServer = await createRendererServer({ pdfJsPath, pdfWorkerPath });

  try {
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
    for (const pageNumber of manifest.selectedPages) {
      const rendered = await page.evaluate(async ({ pageNumber: pageNo, scale }) => {
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

        return {
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
          text
        };
      }, { pageNumber, scale: options.scale });

      const pageLabel = String(pageNumber).padStart(3, "0");
      const imagePath = path.join(outputDir, `${inputBase}.page-${pageLabel}.png`);
      fs.writeFileSync(imagePath, dataUrlToBuffer(rendered.dataUrl));

      let textLayerPath = null;
      if (rendered.text) {
        textLayerPath = path.join(outputDir, `${inputBase}.page-${pageLabel}.text-layer.txt`);
        fs.writeFileSync(textLayerPath, `${rendered.text}\n`, "utf8");
      }

      manifest.pages.push({
        pageNumber,
        imagePath,
        width: rendered.width,
        height: rendered.height,
        textLayerPath,
        textLayerChars: rendered.text.length
      });
    }
  } finally {
    await rendererServer.close();
    await browser.close();
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

  console.log(`Rendered ${manifest.pages.length}/${manifest.pageCount} page(s).`);
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
