import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export function makeRenderTempHtmlPath(outputPath) {
  const outputKey = crypto
    .createHash("sha256")
    .update(path.resolve(outputPath).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return path.join(path.dirname(outputPath), `.classroom-toolkit-render-${outputKey}.html`);
}

export function commitBrowserPdfOutput(temporaryPath, outputPath) {
  if (!fs.existsSync(temporaryPath)) {
    throw new Error(`Browser PDF output was not created: ${temporaryPath}`);
  }

  fs.copyFileSync(temporaryPath, outputPath);
  fs.unlinkSync(temporaryPath);
}
