import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const fixturePath = path.join(repoRoot, "eval", "physics-answer", "cases", "smoke-answer.md");
const smokeDir = path.join(repoRoot, ".smoke-visual");
const baselineDir = path.join(repoRoot, "eval", "physics-answer", "baselines", "visual");

function runNodeScript(scriptFileName, scriptArgs) {
  const result = spawnSync(
    process.execPath,
    [path.join(toolDir, scriptFileName), ...scriptArgs],
    {
      cwd: toolDir,
      stdio: "inherit",
      env: {
        ...process.env,
        INIT_CWD: repoRoot
      }
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function ensureDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function firstPageImagePath(reviewDir) {
  const candidates = fs
    .readdirSync(reviewDir)
    .filter((name) => name.endsWith(".page-001.png"))
    .sort();

  if (candidates.length === 0) {
    throw new Error(`No first-page review image found in ${reviewDir}`);
  }

  return path.join(reviewDir, candidates[0]);
}

function main() {
  ensureDir(smokeDir);
  fs.mkdirSync(baselineDir, { recursive: true });

  const pdfPath = path.join(smokeDir, "smoke-classroom.pdf");
  const reviewDir = path.join(smokeDir, "review");
  const baselineImagePath = path.join(baselineDir, "smoke-classroom.page-001.png");

  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, pdfPath),
    "--profile",
    "classroom"
  ]);

  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, pdfPath),
    "--out",
    path.relative(repoRoot, reviewDir),
    "--scale",
    "2"
  ]);

  const actualImagePath = firstPageImagePath(reviewDir);

  if (!fs.existsSync(baselineImagePath)) {
    fs.copyFileSync(actualImagePath, baselineImagePath);
    console.log(`Created baseline: ${baselineImagePath}`);
  } else {
    runNodeScript("visual-regression.mjs", [
      path.relative(repoRoot, actualImagePath),
      path.relative(repoRoot, baselineImagePath)
    ]);
  }

  fs.rmSync(smokeDir, { recursive: true, force: true });
  console.log("[visual-smoke] passed");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
}
