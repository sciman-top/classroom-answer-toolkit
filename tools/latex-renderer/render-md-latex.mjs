import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import katex from "katex";
import { chromium } from "playwright-core";
import { loadRenderProfile, DEFAULT_PROFILE_NAME, listBuiltInProfiles } from "./render-profiles.mjs";

function parseArgs(argv) {
  const positional = [];
  const options = {
    profile: DEFAULT_PROFILE_NAME
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

    positional.push(arg);
  }

  return { positional, options };
}

const { positional, options } = parseArgs(process.argv.slice(2));
const [inputArg, outputArg] = positional;

if (!inputArg) {
  console.error(`Usage: npm run render -- <input.md> [output.pdf] [--profile classroom|compact]\nBuilt-in profiles: ${listBuiltInProfiles().join(", ")}`);
  process.exit(2);
}

const callerCwd = process.env.INIT_CWD || process.cwd();
const inputPath = path.resolve(callerCwd, inputArg);
const outputPath = path.resolve(
  outputArg ? path.resolve(callerCwd, outputArg) : inputPath.replace(/\.md$/i, ".pdf")
);
const renderProfile = loadRenderProfile(options.profile, callerCwd);

const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
if (!browserPath) {
  console.error("No local Chrome or Edge executable found for PDF rendering.");
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

const source = fs.readFileSync(inputPath, "utf8");
const normalizedSource = normalizeQuestionLeadLines(source);
const renderedMarkdown = md.render(replaceMath(normalizedSource));
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
