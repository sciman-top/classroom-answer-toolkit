import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import katex from "katex";
import { chromium } from "playwright-core";

const [, , inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error("Usage: npm run render -- <input.md> [output.pdf]");
  process.exit(2);
}

const callerCwd = process.env.INIT_CWD || process.cwd();
const inputPath = path.resolve(callerCwd, inputArg);
const outputPath = path.resolve(
  outputArg ? path.resolve(callerCwd, outputArg) : inputPath.replace(/\.md$/i, ".pdf")
);

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
  size: A4;
  margin: 16mm 17mm;
}

html,
body {
  margin: 0;
  padding: 0;
  color: #111;
  font-family: "Microsoft YaHei", "SimHei", "Noto Sans CJK SC", sans-serif;
  font-size: 13.5pt;
  line-height: 1.55;
}

body {
  max-width: 158mm;
}

h1 {
  font-size: 21pt;
  line-height: 1.25;
  margin: 0 0 9pt;
  font-weight: 700;
}

h2 {
  font-size: 16pt;
  line-height: 1.35;
  margin: 15pt 0 7pt;
  color: #164a7a;
  font-weight: 700;
}

p {
  margin: 0 0 6pt;
}

strong {
  font-weight: 700;
}

.katex {
  font-size: 1.02em;
}

.katex-display {
  text-align: left !important;
  margin: 0.18em 0 0.35em;
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
    format: "A4",
    printBackground: true,
    margin: {
      top: "16mm",
      right: "17mm",
      bottom: "16mm",
      left: "17mm"
    }
  });
} finally {
  await browser.close();
  fs.rmSync(tempHtmlPath, { force: true });
}

console.log(outputPath);
