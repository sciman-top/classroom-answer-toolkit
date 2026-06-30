import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import katex from "katex";
import { chromium } from "playwright-core";
import { loadRenderProfile } from "./render-profiles.mjs";
import { getDefaultSubjectPack, loadRequiredResolvedSnapshot, resolveSnapshotPath } from "./runtime-config.mjs";

function parseArgs(argv) {
  const positional = [];
  const options = {
    profile: null,
    snapshot: null,
    subjectPack: getDefaultSubjectPack()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }

    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg === "--snapshot") {
      options.snapshot = argv[++index];
      continue;
    }

    if (arg.startsWith("--snapshot=")) {
      options.snapshot = arg.slice("--snapshot=".length);
      continue;
    }

    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }

    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }

    positional.push(arg);
  }

  return { positional, options };
}

const { positional, options } = parseArgs(process.argv.slice(2));
const [inputArg, outputArg] = positional;

if (options.help) {
  console.log("Usage: npm run render -- <input.md> [output.pdf] [--profile classroom|compact] [--snapshot <snapshot.json>]");
  process.exit(0);
}

if (!inputArg) {
  console.error("Usage: npm run render -- <input.md> [output.pdf] [--profile classroom|compact] [--snapshot <snapshot.json>]");
  process.exit(2);
}

const callerCwd = process.env.INIT_CWD || process.cwd();
const inputPath = path.resolve(callerCwd, inputArg);
const outputPath = path.resolve(
  outputArg ? path.resolve(callerCwd, outputArg) : inputPath.replace(/\.md$/i, ".pdf")
);
const snapshot = loadRequiredResolvedSnapshot(
  resolveSnapshotPath(options.snapshot, {
    subjectPack: options.subjectPack,
    callerCwd
  })
);
const renderProfile = loadRenderProfile(options.profile, snapshot);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const browserCandidates = [
  path.join(process.env.LOCALAPPDATA ?? "", "Chromium", "Application", "chrome.exe"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
if (!browserPath) {
  console.error("No local Chromium, Chrome, or Edge executable found for PDF rendering.");
  process.exit(3);
}

const md = new MarkdownIt({
  html: true,
  breaks: true,
  typographer: false
});

const mathBlocks = [];

function normalizeQuestionLeadLines(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalized = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const questionOnly = line.match(/^(\s*\d{1,3}[.．、])\s*$/u);

    if (questionOnly) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && lines[nextIndex].trim() === "") {
        nextIndex += 1;
      }

      const nextLine = lines[nextIndex] ?? "";
      if (/^\s*[（(][一二三四五六七八九十\d]+[）)]/u.test(nextLine)) {
        normalized.push(`${questionOnly[1]} ${nextLine.trimStart()}`);
        index = nextIndex;
        continue;
      }
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function stashMath(tex, displayMode) {
  const html = katex.renderToString(tex.trim(), {
    displayMode,
    throwOnError: true,
    strict: "error",
    fleqn: true,
    trust: false,
    output: "htmlAndMathml"
  });
  const token = `@@LATEX_MATH_${mathBlocks.length}@@`;
  mathBlocks.push({ token, html });
  return token;
}

function replaceMath(markdown) {
  let text = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) =>
    stashMath(tex, true)
  );
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex) =>
    stashMath(tex, true)
  );
  text = text.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_match, prefix, tex) =>
    `${prefix}${stashMath(tex, false)}`
  );
  return text;
}

function injectMath(html) {
  let output = html;
  for (const block of mathBlocks) {
    output = output.split(block.token).join(block.html);
  }
  return output;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizePlacementMode(placementMode) {
  const safeMode = String(placementMode ?? "inline-medium")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeMode || "inline-medium";
}

function renderAnswerGraphicHtml(placementPath) {
  const placement = JSON.parse(fs.readFileSync(placementPath, "utf8"));
  if (placement?.kind !== "placed-answer-graphic") {
    throw new Error(`Unsupported answer graphic placement kind in ${placementPath}`);
  }

  const previewPath = placement.previewPath
    ? path.resolve(path.dirname(placementPath), placement.previewPath)
    : null;

  if (!previewPath || !fs.existsSync(previewPath)) {
    throw new Error(`Answer graphic preview not found: ${previewPath ?? "<missing previewPath>"}`);
  }

  const placementMode = sanitizePlacementMode(placement.placementMode);
  const widthMm = Number(placement.figureWidthMm);
  const figureWidthStyle = Number.isFinite(widthMm) && widthMm > 0
    ? `width: ${widthMm}mm; max-width: 100%;`
    : "width: 100%; max-width: 100%;";
  const figureStyle = [
    figureWidthStyle,
    "break-inside: avoid",
    "page-break-inside: avoid",
    "margin: 0.75em 0"
  ].join(" ");
  const figureClass = `answer-graphic answer-graphic-${placementMode}`;
  const altText = escapeHtml(placement.graphicId || placement.questionRef || "answer graphic");

  let mediaHtml;
  if (/\.svg$/i.test(previewPath)) {
    mediaHtml = fs.readFileSync(previewPath, "utf8").replace(/^<\?xml[^>]+>\s*/u, "");
  } else {
    mediaHtml = `<img src="${escapeHtml(pathToFileURL(previewPath).href)}" alt="${altText}" />`;
  }

  return `<div class="answer-graphic-shell ${escapeHtml(figureClass)}" style="${escapeHtml(figureStyle)}">${mediaHtml}</div>`;
}

function expandAnswerGraphicMarkers(markdown, sourcePath) {
  return markdown.replace(/<!--\s*answer-graphic:\s*(.+?)\s*-->/g, (_match, placementPath) => {
    const resolvedPlacementPath = path.resolve(path.dirname(sourcePath), placementPath.trim());
    return `\n\n${renderAnswerGraphicHtml(resolvedPlacementPath)}\n\n`;
  });
}

const source = fs.readFileSync(inputPath, "utf8");
const normalizedSource = normalizeQuestionLeadLines(source);
const renderedMarkdown = md.render(replaceMath(expandAnswerGraphicMarkers(normalizedSource, inputPath)));
const body = injectMath(renderedMarkdown);

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const katexCss = fs.readFileSync(
  path.join(toolDir, "node_modules", "katex", "dist", "katex.min.css"),
  "utf8"
);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
${katexCss}

@page {
  size: ${renderProfile.page.size};
  margin: ${renderProfile.page.margin.topMm}mm ${renderProfile.page.margin.rightMm}mm ${renderProfile.page.margin.bottomMm}mm ${renderProfile.page.margin.leftMm}mm;
}

html,
body {
  margin: 0;
  padding: 0;
  color: #111;
  font-family: ${renderProfile.typography.fontFamily};
  font-size: ${renderProfile.typography.bodyFontSizePt}pt;
  line-height: ${renderProfile.typography.lineHeight};
}

body {
  max-width: ${renderProfile.typography.maxBodyWidthMm}mm;
}

h1 {
  font-size: ${renderProfile.typography.h1FontSizePt}pt;
  line-height: ${renderProfile.typography.h1LineHeight};
  margin: 0 0 ${renderProfile.typography.h1MarginBottomPt}pt;
  font-weight: 700;
}

h2 {
  font-size: ${renderProfile.typography.h2FontSizePt}pt;
  line-height: ${renderProfile.typography.h2LineHeight};
  margin: ${renderProfile.typography.h2MarginTopPt}pt 0 ${renderProfile.typography.h2MarginBottomPt}pt;
  color: #164a7a;
  font-weight: 700;
}

p {
  margin: 0 0 ${renderProfile.typography.paragraphMarginBottomPt}pt;
}

strong {
  font-weight: 700;
}

div.answer-graphic-shell {
  margin: 0.75em 0;
  break-inside: avoid;
  page-break-inside: avoid;
}

div.answer-graphic-shell.answer-graphic-inline-small {
  width: 72mm;
  max-width: 100%;
}

div.answer-graphic-shell.answer-graphic-inline-medium {
  width: 120mm;
  max-width: 100%;
}

div.answer-graphic-shell.answer-graphic-inline-large {
  width: 150mm;
  max-width: 100%;
}

div.answer-graphic-shell.answer-graphic-full-width {
  width: 100%;
  max-width: 100%;
}

div.answer-graphic-shell > svg,
div.answer-graphic-shell > img {
  display: block;
  width: 100%;
  height: auto;
}

.katex {
  font-size: ${renderProfile.typography.katexScale}em;
}

.katex-display {
  text-align: left !important;
  margin: ${renderProfile.typography.displayMathMarginTopEm}em 0 ${renderProfile.typography.displayMathMarginBottomEm}em;
}

.katex-display > .katex {
  text-align: left !important;
}

.katex-html {
  white-space: normal;
}
</style>
</head>
<body>
${body}
</body>
</html>`;

const tempHtmlPath = path.join(
  path.dirname(outputPath),
  `.${path.basename(outputPath, ".pdf")}.render.html`
);
fs.writeFileSync(tempHtmlPath, html, "utf8");

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "load" });
  await page.pdf({
    path: outputPath,
    format: renderProfile.page.size,
    printBackground: true,
    margin: {
      top: `${renderProfile.page.margin.topMm}mm`,
      right: `${renderProfile.page.margin.rightMm}mm`,
      bottom: `${renderProfile.page.margin.bottomMm}mm`,
      left: `${renderProfile.page.margin.leftMm}mm`
    }
  });
} finally {
  await browser.close();
  fs.rmSync(tempHtmlPath, { force: true });
}

console.log(outputPath);
