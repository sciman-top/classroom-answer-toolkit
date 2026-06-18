import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const fixturePath = path.join(repoRoot, "eval", "physics-answer", "cases", "smoke-answer.md");
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  ensureCleanSmokeDir();

  const reviewDir = path.join(smokeDir, "review-classroom");
  const deliverPdfPath = path.join(smokeDir, "smoke-deliver.pdf");
  const deliverManifestPath = path.join(smokeDir, "smoke-deliver.delivery-manifest.json");
  const snapshotPaths = {
    classroom: path.join(smokeDir, "resolved-snapshot.classroom.json"),
    compact: path.join(smokeDir, "resolved-snapshot.compact.json")
  };

  for (const profile of ["classroom", "compact"]) {
    console.log(`[smoke] compile snapshot ${profile}`);
    runNodeScript(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
      "--profile",
      profile,
      "--out",
      path.relative(repoRoot, snapshotPaths[profile])
    ]);
  }

  console.log("[smoke] validate classroom");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "classroom",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.classroom)
  ]);

  console.log("[smoke] validate compact");
  runNodeScript("validate-answer-markdown.mjs", [
    path.relative(repoRoot, fixturePath),
    "--profile",
    "compact",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.compact)
  ]);

  console.log("[smoke] render classroom");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, path.join(smokeDir, "smoke-classroom.pdf")),
    "--profile",
    "classroom",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.classroom)
  ]);

  console.log("[smoke] render compact");
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, path.join(smokeDir, "smoke-compact.pdf")),
    "--profile",
    "compact",
    "--snapshot",
    path.relative(repoRoot, snapshotPaths.compact)
  ]);

  console.log("[smoke] review classroom pdf");
  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, path.join(smokeDir, "smoke-classroom.pdf")),
    "--out",
    path.relative(repoRoot, reviewDir),
    "--scale",
    "2"
  ]);

  console.log("[smoke] deliver classroom");
  runNodeScript("deliver-answer.mjs", [
    path.relative(repoRoot, fixturePath),
    path.relative(repoRoot, deliverPdfPath),
    "--profile",
    "classroom",
    "--keep-review"
  ]);

  if (!fs.existsSync(deliverManifestPath)) {
    throw new Error(`Deliver manifest not found: ${deliverManifestPath}`);
  }

  const deliverManifest = readJson(deliverManifestPath);
  const classroomSnapshot = readJson(snapshotPaths.classroom);
  if (deliverManifest.snapshotId !== classroomSnapshot.snapshotId) {
    throw new Error(`Deliver manifest snapshotId mismatch: expected ${classroomSnapshot.snapshotId}, got ${deliverManifest.snapshotId}`);
  }

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
