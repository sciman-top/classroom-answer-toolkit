import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { removePathRecursive } from "../safe-remove.mjs";
import { parseArgvFlags } from "../shared.mjs";
import { makeRenderTempHtmlPath, makeReviewOutputDir } from "./pdf-output-path.mjs";
import { getDefaultSubjectPack, getSnapshotActiveProfile, loadRequiredResolvedSnapshot, resolveSnapshotPath } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const packageJsonPath = path.join(toolDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = packageJson.name ?? "junior-physics-answer-latex-renderer";

const usage = `Usage:
  npm --prefix tools/latex-renderer run deliver -- <answer.md> [output.pdf] [--profile classroom|compact] [--snapshot-path <snapshot.json>] [--keep-review] [--review-scale 2] [--skip-validate]

Examples:
  npm --prefix tools/latex-renderer run deliver -- "样例交付/能量-效率参考答案.md"
  npm --prefix tools/latex-renderer run deliver -- "样例交付/能量-效率参考答案.md" --keep-review

Behavior:
  1. Render the answer Markdown to PDF.
  2. Render the answer PDF into review page images for visual QA.
  3. Copy the review set beside the PDF as <pdf-base>.review for archival.
  4. If both steps succeed, automatically clean transient artifacts unless you keep them.
  5. If any step fails, keep all temporary artifacts for debugging.
`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function resolveToolScript(scriptFileName) {
  return path.isAbsolute(scriptFileName)
    ? scriptFileName
    : path.resolve(toolDir, scriptFileName);
}

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: {
      profile: true,
      "snapshot-path": "snapshotPath",
      "review-scale": "reviewScale",
      "subject-pack": true
    },
    booleanFlags: {
      "keep-review": "keepReview",
      "skip-validate": "skipValidate"
    },
    defaults: {
      profile: null,
      snapshotPath: null,
      keepReview: false,
      reviewScale: "2",
      skipValidate: false,
      subjectPack: getDefaultSubjectPack()
    },
    help: true,
    unknownFlag: "positional",
    positional: true
  });
}

const childStepTimeoutMs = 10 * 60 * 1000;

function runNodeScript(scriptFileName, scriptArgs) {
  const filteredArgs = scriptArgs.filter((value) => value !== undefined && value !== null && value !== "");
  const result = spawnSync(
    process.execPath,
    [resolveToolScript(scriptFileName), ...filteredArgs],
    {
      cwd: toolDir,
      stdio: "inherit",
      timeout: childStepTimeoutMs,
      env: {
        ...process.env,
        INIT_CWD: repoRoot
      }
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (result.signal) {
      const timedOut = result.signal === "SIGTERM" && result.status === null;
      console.error(
        `${scriptFileName} terminated by signal ${result.signal}`
        + `${timedOut ? ` (step exceeded ${childStepTimeoutMs / 60000} minutes)` : ""}.`
      );
    }
    process.exit(typeof result.status === "number" ? result.status : 2);
  }
}

function makeDeliveryManifestPath(pdfPath) {
  return path.resolve(
    path.dirname(pdfPath),
    `${path.basename(pdfPath, path.extname(pdfPath))}.delivery-manifest.json`
  );
}

function makeDeliverySnapshotPath(pdfPath) {
  return path.resolve(
    path.dirname(pdfPath),
    `${path.basename(pdfPath, path.extname(pdfPath))}.snapshot.json`
  );
}

function makeDeliveryReviewPath(pdfPath) {
  return path.resolve(
    path.dirname(pdfPath),
    `${path.basename(pdfPath, path.extname(pdfPath))}.review`
  );
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const callerCwd = process.env.INIT_CWD || process.cwd();

  if (options.help) {
    console.log(usage);
    process.exit(0);
  }

  if (positional.length < 1 || positional.length > 2) {
    fail(usage);
  }

  const inputPath = path.resolve(repoRoot, positional[0]);
  const outputPath = positional[1]
    ? path.resolve(repoRoot, positional[1])
    : path.resolve(
        path.dirname(inputPath),
        path.basename(inputPath).replace(/\.md$/i, ".pdf")
      );

  if (!fs.existsSync(inputPath)) {
    fail(`Answer Markdown not found: ${inputPath}`);
  }

  if (!/\.md$/i.test(inputPath)) {
    fail(`Expected a Markdown answer file: ${inputPath}`);
  }

  if (!/\.pdf$/i.test(outputPath)) {
    fail(`Expected a PDF output file: ${outputPath}`);
  }

  const reviewOutputDir = makeReviewOutputDir(repoRoot, outputPath);
  const snapshotPath = resolveSnapshotPath(options.snapshotPath, {
    subjectPack: options.subjectPack,
    callerCwd
  });
  const compileProfile = options.profile ?? "classroom";

  if (!options.snapshotPath) {
    console.log(`[${packageName}] compile-snapshot`);
    runNodeScript(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
      "--subject-pack",
      options.subjectPack,
      "--profile",
      compileProfile,
      "--out",
      path.relative(repoRoot, snapshotPath)
    ]);
  } else {
    console.log(`[${packageName}] reuse snapshot`);
  }

  if (!fs.existsSync(snapshotPath)) {
    fail(`Resolved snapshot not found: ${snapshotPath}`);
  }

  const snapshot = loadRequiredResolvedSnapshot(snapshotPath);
  const activeProfile = getSnapshotActiveProfile(snapshot, options.profile);
  const profileName = activeProfile.name;
  const snapshotSubjectPack = snapshot.subjectPack?.assetId;
  if (typeof snapshotSubjectPack !== "string" || snapshotSubjectPack.trim().length === 0) {
    fail(`Resolved snapshot is missing subjectPack.assetId: ${snapshotPath}`);
  }

  const deliverySnapshotPath = makeDeliverySnapshotPath(outputPath);
  writeTextFileAtomic(deliverySnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  if (!options.skipValidate) {
    console.log(`[${packageName}] validate: ${path.relative(repoRoot, inputPath)}`);
    runNodeScript("validate-answer-markdown.mjs", [
      path.relative(repoRoot, inputPath),
      "--subject-pack",
      snapshotSubjectPack,
      "--profile",
      profileName,
      "--snapshot",
      path.relative(repoRoot, snapshotPath)
    ]);
  }

  console.log(`[${packageName}] render: ${path.relative(repoRoot, inputPath)}`);
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, inputPath),
    path.relative(repoRoot, outputPath),
    "--subject-pack",
    snapshotSubjectPack,
    "--profile",
    profileName,
    "--snapshot",
    path.relative(repoRoot, snapshotPath)
  ]);

  console.log(`[${packageName}] review: ${path.relative(repoRoot, outputPath)}`);
  removePathRecursive(reviewOutputDir);
  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, outputPath),
    "--out",
    path.relative(repoRoot, reviewOutputDir),
    "--scale",
    options.reviewScale
  ]);

  // The repository-local review directory is a transient debugging surface.
  // Keep a delivery-owned copy beside the PDF so archives remain self-contained.
  const deliveryReviewDir = makeDeliveryReviewPath(outputPath);
  removePathRecursive(deliveryReviewDir);
  // On Windows, Node's synchronous recursive copy can terminate the process
  // with STATUS_STACK_BUFFER_OVERRUN for real delivery paths containing CJK
  // names. The asynchronous implementation copies the same tree safely.
  await fsp.cp(reviewOutputDir, deliveryReviewDir, { recursive: true });

  const cleanupArgs = ["--keep-review"];
  if (!options.keepReview) {
    cleanupArgs.push(path.relative(repoRoot, reviewOutputDir));
  }

  console.log(`[${packageName}] cleanup`);
  if (snapshot.delivery?.rules?.cleanupAfterSuccessfulDeliver !== false) {
    runNodeScript("cleanup-answer-artifacts.mjs", cleanupArgs);
    if (!options.keepReview) {
      const reviewRoot = path.join(repoRoot, ".pdf-review");
      if (fs.existsSync(reviewRoot) && fs.readdirSync(reviewRoot).length === 0) {
        removePathRecursive(reviewRoot);
      }
    }
  } else {
    console.log(`[${packageName}] cleanup skipped by runtime config`);
  }

  const reviewManifestPath = path.join(deliveryReviewDir, "manifest.json");
  console.log(`[${packageName}] write-delivery-manifest`);
  runNodeScript("write-delivery-manifest.mjs", [
    "--input",
    path.relative(repoRoot, inputPath),
    "--output",
    path.relative(repoRoot, outputPath),
    "--snapshot-path",
    path.relative(repoRoot, deliverySnapshotPath),
    "--review-dir",
    path.relative(repoRoot, deliveryReviewDir),
    "--review-manifest",
    path.relative(repoRoot, reviewManifestPath),
    "--review-scale",
    options.reviewScale
  ]);

  console.log(`[${packageName}] validate-delivery-manifest`);
  runNodeScript("validate-delivery-manifest.mjs", [
    "--manifest",
    path.relative(repoRoot, makeDeliveryManifestPath(outputPath))
  ]);

  console.log(`[${packageName}] deliver complete: ${path.relative(repoRoot, outputPath)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
