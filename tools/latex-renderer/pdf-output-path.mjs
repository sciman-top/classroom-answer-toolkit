import fs from "node:fs";
import path from "node:path";

import { sha256Hex } from "../shared.mjs";

function sanitizeToken(value) {
  const token = String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!token) {
    throw new Error("Browser PDF output token must contain an ASCII letter or digit.");
  }
  return token;
}

export function makeBrowserPdfOutputPath(outputPath, token = `${process.pid}-${Date.now()}`) {
  return path.join(
    path.dirname(outputPath),
    `.classroom-toolkit-render-${sanitizeToken(token)}.pdf`
  );
}

export function makeRenderTempHtmlPath(outputPath, token = `${process.pid}-${Date.now()}`) {
  const outputKey = sha256Hex(path.resolve(outputPath).toLowerCase()).slice(0, 16);
  return path.join(path.dirname(outputPath), `.classroom-toolkit-render-${outputKey}-${sanitizeToken(token)}.html`);
}

export function makeReviewOutputDir(repositoryRoot, outputPath) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedOutput = path.resolve(outputPath);
  const relativeOutput = path.relative(resolvedRoot, resolvedOutput);
  const isExternal = path.isAbsolute(relativeOutput)
    || relativeOutput === ".."
    || relativeOutput.startsWith(`..${path.sep}`);
  const outputKey = sha256Hex(resolvedOutput.toLowerCase()).slice(0, 16);
  const parent = path.dirname(relativeOutput);
  const flattenedParent = parent === "."
    ? ""
    : parent.replace(/[\\/]+/g, "__");
  const parentToken = isExternal
    ? `external-${outputKey}`
    : flattenedParent.length > 80
      ? `nested-${outputKey}`
      : flattenedParent;
  const outputName = path.basename(resolvedOutput, path.extname(resolvedOutput));
  const folderName = parentToken ? `${parentToken}__${outputName}` : outputName;
  return path.join(resolvedRoot, ".pdf-review", folderName);
}

export function commitBrowserPdfOutput(temporaryPath, outputPath) {
  if (!fs.existsSync(temporaryPath)) {
    throw new Error(`Browser PDF output was not created: ${temporaryPath}`);
  }

  fs.renameSync(temporaryPath, outputPath);
}
