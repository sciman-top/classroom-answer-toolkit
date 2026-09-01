import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import katex from "katex";
import { chromium } from "playwright-core";
import { resolveLocalBrowserPath } from "./browser-candidates.mjs";
import {
  commitBrowserPdfOutput,
  makeBrowserPdfOutputPath,
  makeRenderTempHtmlPath
} from "./pdf-output-path.mjs";
import { loadRenderProfile } from "./render-profiles.mjs";
import {
  findUnbalancedLatexDelimiterPositions,
  mapInlineMath,
  maskLatexCodeSegments,
  normalizeLatexParenDelimiters,
  repairSplitMathSpans,
  restoreLatexCodeSegments
} from "./inline-math.mjs";
import { parseArgvFlags } from "../shared.mjs";
import { getDefaultSubjectPack, loadRequiredResolvedSnapshot, resolveSnapshotPath } from "./runtime-config.mjs";

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: { profile: true, snapshot: true, "subject-pack": true },
    defaults: { profile: null, snapshot: null, subjectPack: getDefaultSubjectPack() },
    help: true,
    unknownFlag: "positional",
    positional: true
  });
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
if (!/\.md$/i.test(inputPath)) {
  console.error(`Refusing to render: input must be a Markdown file ending in .md (got ${inputArg}).`);
  process.exit(2);
}
if (outputPath.toLowerCase() === inputPath.toLowerCase()) {
  console.error("Refusing to render: output PDF path must differ from the input Markdown path.");
  process.exit(2);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Input Markdown not found: ${inputPath}`);
  process.exit(2);
}
const snapshot = loadRequiredResolvedSnapshot(
  resolveSnapshotPath(options.snapshot, {
    subjectPack: options.subjectPack,
    callerCwd
  })
);
const renderProfile = loadRenderProfile(options.profile, snapshot);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const browserPath = resolveLocalBrowserPath();
const sharedBrowserWsEndpoint = process.env.CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT?.trim() || null;
if (!sharedBrowserWsEndpoint && !browserPath) {
  console.error("No local Chromium, Chrome, or Edge executable found for PDF rendering.");
  process.exit(3);
}

const md = new MarkdownIt({
  html: false,
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
  const masked = maskLatexCodeSegments(markdown);
  let text = normalizeLatexParenDelimiters(repairSplitMathSpans(masked.text));
  // Fail closed on delimiters the single pass below cannot consume; without this
  // guard the leftover `\(`/`\[` reaches the PDF as literal source
  // (2015 regression10 class of delivery defects).
  const unbalancedPositions = findUnbalancedLatexDelimiterPositions(text);
  if (unbalancedPositions.length > 0) {
    const lineNumbers = [...new Set(unbalancedPositions.map((position) => lineNumberAt(text, position)))]
      .sort((a, b) => a - b);
    throw new Error(
      `Unbalanced \\(...\\) or \\[...\\] LaTeX delimiters on line(s) ${lineNumbers.join(", ")}; `
      + "literal source would reach the PDF. Run validate:answer for details."
    );
  }
  try {
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) =>
      stashMath(tex, true)
    );
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex) =>
      stashMath(tex, true)
    );
    // The validator consumes the same scanner via inline-math.mjs; keep both sides
    // on one implementation so validated documents cannot render differently.
    return restoreLatexCodeSegments(mapInlineMath(text, (tex) => stashMath(tex, false)), masked.segments);
  } catch (error) {
    throw new Error(`LaTeX math failed the strict renderer contract; run validate:answer for line-precise errors. ${error.message}`);
  }
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function injectMath(html) {
  let output = html;
  for (const block of mathBlocks) {
    output = output.split(block.token).join(block.html);
  }
  return output;
}

const voidHtmlElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr"
]);

// Markdown-it emits one top-level block element per paragraph, table, heading,
// or controlled graphic. Keep those blocks intact so a question cannot leave
// only its final formula lines on a nearly empty trailing page.
function splitTopLevelHtmlBlocks(html) {
  const tagPattern = /<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\/?\s*>/giu;
  const blocks = [];
  let depth = 0;
  let rootStart = null;
  let previousEnd = 0;

  for (const match of html.matchAll(tagPattern)) {
    const tag = match[1].toLowerCase();
    const source = match[0];
    const isClosing = source.startsWith("</");
    const isSelfClosing = /\/\s*>$/u.test(source) || voidHtmlElements.has(tag);

    if (isClosing) {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && rootStart !== null) {
        const end = (match.index ?? 0) + source.length;
        blocks.push({
          prefix: html.slice(previousEnd, rootStart),
          html: html.slice(rootStart, end)
        });
        previousEnd = end;
        rootStart = null;
      }
      continue;
    }

    if (depth === 0 && rootStart === null) {
      rootStart = match.index ?? 0;
    }
    if (!isSelfClosing) {
      depth += 1;
    } else if (depth === 0 && rootStart !== null) {
      const end = (match.index ?? 0) + source.length;
      blocks.push({
        prefix: html.slice(previousEnd, rootStart),
        html: html.slice(rootStart, end)
      });
      previousEnd = end;
      rootStart = null;
    }
  }

  if (previousEnd < html.length) {
    blocks.push({ prefix: html.slice(previousEnd), html: "" });
  }
  return blocks;
}

function isQuestionBlock(blockHtml) {
  return /^<p(?:\s[^>]*)?>\s*\d{1,3}[.．、]/u.test(blockHtml)
    || /^<ol\b[^>]*\bstart\s*=\s*["']?\d{1,3}/iu.test(blockHtml);
}

function isHeadingBlock(blockHtml) {
  return /^<h[1-6](?:\s[^>]*)?>/iu.test(blockHtml);
}

function splitNumberedQuestionList(blockHtml) {
  const olMatch = /^<ol(\s[^>]*?)?\sstart\s*=\s*["']?(\d{1,3})["']?([^>]*)>([\s\S]*)<\/ol>$/iu.exec(blockHtml);
  if (!olMatch) {
    return null;
  }
  const listInner = olMatch[4];
  // Nested lists would break the flat <li> scan below; keep such a block whole.
  if (/<[ou]l\b/iu.test(listInner)) {
    return null;
  }
  const items = listInner.match(/<li(?:\s[^>]*)?>[\s\S]*?<\/li>/giu);
  if (!items || items.length < 2) {
    return null;
  }
  const startNumber = Number(olMatch[2]);
  const leadingAttrs = olMatch[1] ?? "";
  const trailingAttrs = olMatch[3] ?? "";
  return items.map((item, index) =>
    `<div class="answer-question"><ol start="${startNumber + index}"${leadingAttrs}${trailingAttrs}>${item}</ol></div>`
  );
}

function wrapQuestionBlocks(html) {
  const blocks = splitTopLevelHtmlBlocks(html);
  let output = "";
  let inQuestion = false;

  for (const block of blocks) {
    const startsQuestion = isQuestionBlock(block.html);
    const startsHeading = isHeadingBlock(block.html);
    if (inQuestion && (startsQuestion || startsHeading)) {
      output += "</div>\n";
      inQuestion = false;
    }
    output += block.prefix;
    if (startsQuestion) {
      // A markdown ordered list starting at a question number swallows every
      // following question into one block; keeping that whole list inside a
      // single break-inside:avoid div forces an almost-blank page whenever the
      // list is taller than the remaining page space.
      const questionListPieces = splitNumberedQuestionList(block.html);
      if (questionListPieces) {
        output += questionListPieces.join("\n");
        continue;
      }
      output += '<div class="answer-question">';
      inQuestion = true;
    }
    output += block.html;
  }

  if (inQuestion) {
    output += "</div>\n";
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

  const mediaHtml = `<img src="${escapeHtml(pathToFileURL(previewPath).href)}" alt="${altText}" />`;

  return `<div class="answer-graphic-shell ${escapeHtml(figureClass)}" style="${escapeHtml(figureStyle)}">${mediaHtml}</div>`;
}

function expandAnswerGraphicMarkers(markdown, sourcePath) {
  const graphics = [];
  const expandedMarkdown = markdown.replace(/<!--\s*answer-graphic:\s*(.+?)\s*-->/g, (_match, placementPath) => {
    const resolvedPlacementPath = path.resolve(path.dirname(sourcePath), placementPath.trim());
    const token = `CLASSROOM_TOOLKIT_ANSWER_GRAPHIC_${crypto.randomUUID().replace(/-/g, "")}`;
    graphics.push({ token, html: renderAnswerGraphicHtml(resolvedPlacementPath) });
    return `\n\n${token}\n\n`;
  });
  return { expandedMarkdown, graphics };
}

function injectAnswerGraphics(html, graphics) {
  let output = html;
  for (const graphic of graphics) {
    output = output.split(`<p>${graphic.token}</p>\n`).join(`${graphic.html}\n`);
    if (output.includes(graphic.token)) {
      throw new Error("Unable to restore a controlled answer graphic marker after Markdown rendering.");
    }
  }
  return output;
}

// The temp HTML lives in the output directory, so relative image URLs would resolve
// against the wrong base when output differs from the source directory. Resolve every
// local image against the Markdown source and fail closed when it does not exist.
function resolveLocalImageRefs(markdown, sourcePath) {
  return markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, (match, lead, url, tail) => {
    if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(url)) {
      return match;
    }
    const sourceDir = path.dirname(sourcePath);
    const candidates = [path.resolve(sourceDir, url)];
    try {
      candidates.push(path.resolve(sourceDir, decodeURIComponent(url)));
    } catch {
      // Keep the raw-path candidate only.
    }
    const imagePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!imagePath) {
      throw new Error(`Image reference not found relative to ${sourceDir}: ${url}`);
    }
    return `${lead}${pathToFileURL(imagePath).href}${tail}`;
  });
}

// Reference-style definitions (`![alt][ref]` + `[ref]: path`) bypass the inline
// precheck above; resolve their targets with the same fail-closed rule so the
// renderer cannot silently emit PDFs with missing images.
function resolveLocalImageDefinitions(markdown, sourcePath) {
  return markdown.replace(/^([ \t]{0,3}\[[^\]]+\]:[ \t]*)([^)\s]+)(.*)$/gm, (match, lead, url, tail) => {
    if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(url)) {
      return match;
    }
    const sourceDir = path.dirname(sourcePath);
    const imagePath = path.resolve(sourceDir, decodeURIComponent(url));
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image reference not found relative to ${sourceDir}: ${url}`);
    }
    return `${lead}${pathToFileURL(imagePath).href}${tail}`;
  });
}

const source = fs.readFileSync(inputPath, "utf8");
const normalizedSource = normalizeQuestionLeadLines(source);
const expanded = expandAnswerGraphicMarkers(normalizedSource, inputPath);
const withResolvedImages = resolveLocalImageDefinitions(
  resolveLocalImageRefs(expanded.expandedMarkdown, inputPath),
  inputPath
);
const renderedMarkdown = md.render(replaceMath(withResolvedImages));
const body = wrapQuestionBlocks(injectAnswerGraphics(injectMath(renderedMarkdown), expanded.graphics));

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const katexDistDir = path.join(toolDir, "node_modules", "katex", "dist");
// KaTeX ships its @font-face sources as URLs relative to the CSS file. Inlined
// into a temp HTML inside the output directory they would all 404 and formulas
// silently fall back to serif fonts, so rewrite them to absolute file URLs.
const katexCss = fs.readFileSync(path.join(katexDistDir, "katex.min.css"), "utf8")
  .replace(/url\((['"]?)(fonts\/[^)'"]+)\1\)/g, (_match, quote, relativeUrl) =>
    `url(${quote}${pathToFileURL(path.join(katexDistDir, relativeUrl)).href}${quote})`
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
  break-after: avoid-page;
  page-break-after: avoid;
}

h2 {
  font-size: ${renderProfile.typography.h2FontSizePt}pt;
  line-height: ${renderProfile.typography.h2LineHeight};
  margin: ${renderProfile.typography.h2MarginTopPt}pt 0 ${renderProfile.typography.h2MarginBottomPt}pt;
  color: #164a7a;
  font-weight: 700;
  break-after: avoid-page;
  page-break-after: avoid;
}

p {
  margin: 0 0 ${renderProfile.typography.paragraphMarginBottomPt}pt;
}

.answer-question {
  break-inside: avoid;
  page-break-inside: avoid;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0 0 ${renderProfile.typography.paragraphMarginBottomPt}pt;
  break-inside: avoid;
  page-break-inside: avoid;
}

th,
td {
  border: 0.5pt solid #333;
  padding: 0.25em 0.4em;
  vertical-align: middle;
  overflow-wrap: anywhere;
}

th {
  font-weight: 700;
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

const tempHtmlPath = makeRenderTempHtmlPath(outputPath);
fs.writeFileSync(tempHtmlPath, html, "utf8");

const RENDER_PDF_TIMEOUT_MS = 120_000;
const browserPdfOutputPath = makeBrowserPdfOutputPath(outputPath);
let browser = null;
let committedPdf = false;
try {
  if (fs.existsSync(browserPdfOutputPath)) {
    fs.unlinkSync(browserPdfOutputPath);
  }
  browser = sharedBrowserWsEndpoint
    ? await chromium.connect(sharedBrowserWsEndpoint)
    : await chromium.launch({
        executablePath: browserPath,
        headless: true
      });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "load" });
  // page.pdf has no built-in deadline; a pathological layout could hang forever
  // on direct `npm run render` (deliver's outer limit never applies there).
  // The loser timer must be cleared: a left-behind 120s timeout would keep the
  // node process alive long after every successful render.
  let pdfTimeoutGuard = null;
  try {
    await Promise.race([
      page.pdf({
        // Chromium on Windows can native-crash when its PDF path has a non-ASCII file name.
        path: browserPdfOutputPath,
        format: renderProfile.page.size,
        printBackground: true,
        margin: {
          top: `${renderProfile.page.margin.topMm}mm`,
          right: `${renderProfile.page.margin.rightMm}mm`,
          bottom: `${renderProfile.page.margin.bottomMm}mm`,
          left: `${renderProfile.page.margin.leftMm}mm`
        }
      }),
      new Promise((_resolve, reject) => {
        pdfTimeoutGuard = setTimeout(
          () => reject(new Error(`page.pdf exceeded ${RENDER_PDF_TIMEOUT_MS / 1000}s; aborting render.`)),
          RENDER_PDF_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    clearTimeout(pdfTimeoutGuard);
  }
  try {
    commitBrowserPdfOutput(browserPdfOutputPath, outputPath);
    committedPdf = true;
  } catch (commitError) {
    // On Windows a locked target (e.g. the PDF open in a reader) fails the
    // rename. Deleting the temp would destroy the finished render, so keep it
    // and tell the user where it is.
    const preservedHint = fs.existsSync(browserPdfOutputPath)
      ? ` The finished render is preserved at ${browserPdfOutputPath}.`
      : "";
    throw new Error(`Could not replace the target PDF: ${commitError.message}.${preservedHint}`);
  }
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (fs.existsSync(tempHtmlPath) && process.env.CLASSROOM_TOOLKIT_KEEP_RENDER_HTML !== "1") {
    fs.unlinkSync(tempHtmlPath);
  }
  if (committedPdf && fs.existsSync(browserPdfOutputPath)) {
    fs.unlinkSync(browserPdfOutputPath);
  }
}

console.log(outputPath);
