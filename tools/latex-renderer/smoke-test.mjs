import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const fixturePath = path.join(toolDir, "fixtures", "smoke-answer.md");
const smokeDir = path.join(repoRoot, ".smoke-work");

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

function ensureCleanSmokeDir() {
  fs.rmSync(smokeDir, { recursive: true, force: true });
  fs.mkdirSync(smokeDir, { recursive: true });
}

function main() {
  ensureCleanSmokeDir();

  const classroomPdf = path.join(smokeDir, "smoke-classroom.pdf");
  const compactPdf = path.join(smokeDir, "smoke-compact.pdf");
  const reviewDir = path.join(smokeDir, "review-classroom");

  console.log("[smoke] validate classroom");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "classroom"
  ]);

  console.log("[smoke] validate compact");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "compact"
  ]);

  console.log("[smoke] render classroom");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, classroomPdf),
    "--profile",
    "classroom"
  ]);

  console.log("[smoke] render compact");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, compactPdf),
    "--profile",
    "compact"
  ]);

  console.log("[smoke] review classroom pdf");
  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, classroomPdf),
    "--out",
    path.relative(repoRoot, reviewDir),
    "--scale",
    "2"
  ]);

  console.log("[smoke] cleanup");
  fs.rmSync(smokeDir, { recursive: true, force: true });
  console.log("[smoke] passed");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
}
