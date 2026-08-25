import fs from "node:fs";
import path from "node:path";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function writeReviewHtml({ outputDir, inputPath, manifest }) {
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
