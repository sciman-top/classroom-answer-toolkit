import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { removePathRecursive } from "../safe-remove.mjs";
import { fail, parseArgvFlags, readJsonFile, repositoryRoot as repoRoot } from "../shared.mjs";
import { resolveLocalBrowserPath } from "./lib/browser-candidates.mjs";
import { makeRenderTempHtmlPath, makeReviewOutputDir } from "./lib/pdf-output-path.mjs";
import { getDefaultSubjectPackName, getSnapshotActiveProfile, loadRequiredResolvedSnapshot, resolveSnapshotPath } from "./lib/runtime-config.mjs";
import { runCleanup } from "./cleanup-answer-artifacts.mjs";
import { validateDeliveryManifest } from "./validate-delivery-manifest.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(toolDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = packageJson.name ?? "junior-physics-answer-latex-renderer";

const usage = `Usage:
  npm --prefix tools/latex-renderer run deliver -- <answer.md> [output.pdf] [--profile classroom|compact] [--snapshot-path <snapshot.json>] [--keep-review] [--review-scale 2] [--skip-validate]

Examples:
  npm --prefix tools/latex-renderer run deliver -- "<答案.md>"
  npm --prefix tools/latex-renderer run deliver -- "<答案.md>" --keep-review

Behavior:
  1. Render the answer Markdown to PDF.
  2. Render the answer PDF into review page images for visual QA.
  3. Copy the review set beside the PDF as <pdf-base>.review for archival.
  4. If both steps succeed, automatically clean transient artifacts unless you keep them.
  5. If any step fails, keep all temporary artifacts for debugging.
`;

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
      subjectPack: getDefaultSubjectPackName()
    },
    help: true,
    unknownFlag: "positional",
    positional: true
  });
}

const childStepTimeoutMs = 10 * 60 * 1000;

// Thrown when a child step exits non-zero so the shared browser (if any) can
// be closed by main's finally before the process exits with the same code the
// direct process.exit used to produce.
class DeliveryStepError extends Error {
  constructor(scriptFileName, status, signal) {
    const timedOut = signal === "SIGTERM" && status === null;
    super(
      `${scriptFileName} terminated by signal ${signal}`
      + `${timedOut ? ` (step exceeded ${childStepTimeoutMs / 60000} minutes)` : ""}.`
      + (status !== null ? ` (exit ${status})` : ""));
    this.name = "DeliveryStepError";
    this.stepExitCode = typeof status === "number" ? status : 2;
  }
}

// Asynchronous on purpose: the shared browser server lives in this process,
// and a synchronous spawn would freeze this event loop so connected steps
// could never finish their WebSocket handshake. The promise resolves with the
// same {status, signal} shape spawnSync produced so error reporting is
// unchanged; each caller awaits.
function runNodeScript(scriptFileName, scriptArgs, extraEnv = null) {
  const filteredArgs = scriptArgs.filter((value) => value !== undefined && value !== null && value !== "");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [resolveToolScript(scriptFileName), ...filteredArgs],
      {
        cwd: toolDir,
        stdio: "inherit",
        env: {
          ...process.env,
          INIT_CWD: repoRoot,
          ...extraEnv
        }
      }
    );

    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new DeliveryStepError(scriptFileName, null, "SIGTERM"));
    }, childStepTimeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ status: code, signal });
    });
  }).then((result) => {
    if (result.status !== 0 || result.signal) {
      throw new DeliveryStepError(scriptFileName, result.status, result.signal);
    }
  });
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

  // Positionals follow the render/validate CLIs: resolved against the caller's
  // CWD (INIT_CWD under npm), not the tool's repo. Internal callers pass
  // absolute paths and are unaffected.
  const inputPath = path.resolve(callerCwd, positional[0]);
  const outputPath = positional[1]
    ? path.resolve(callerCwd, positional[1])
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
    profile: options.profile,
    callerCwd
  });
  const compileProfile = options.profile ?? "classroom";

  if (!options.snapshotPath) {
    console.log(`[${packageName}] compile-snapshot`);
    await runNodeScript(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
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

  if (!options.skipValidate) {
    console.log(`[${packageName}] validate: ${path.relative(repoRoot, inputPath)}`);
    await runNodeScript("validate-answer-markdown.mjs", [
      path.relative(repoRoot, inputPath),
      "--subject-pack",
      snapshotSubjectPack,
      "--profile",
      profileName,
      "--snapshot",
      path.relative(repoRoot, snapshotPath)
    ]);
  }

  // One browser cold start serves both render and review: the endpoint is
  // passed through the env hook both steps already consume, and the host owns
  // the browser lifetime (connected steps close only their own pages). An
  // externally provided endpoint is honored instead of launching a second one.
  const externalBrowserEndpoint = process.env.CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT?.trim() || null;
  let sharedBrowserServer = null;
  let browserEnv;
  if (externalBrowserEndpoint) {
    browserEnv = {};
  } else {
    const browserPath = resolveLocalBrowserPath();
    if (!browserPath) {
      fail("No local Chromium, Chrome, or Edge executable found for PDF rendering.", 3);
    }
    // launchServer (not launch): connectable steps need a ws endpoint, and the
    // eval pipeline already shares its browser this way.
    sharedBrowserServer = await chromium.launchServer({
      executablePath: browserPath,
      headless: true
    });
    browserEnv = { CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT: sharedBrowserServer.wsEndpoint() };
  }

  try {
    console.log(`[${packageName}] render: ${path.relative(repoRoot, inputPath)}`);
    await runNodeScript("render-md-latex.mjs", [
      path.relative(repoRoot, inputPath),
      path.relative(repoRoot, outputPath),
      "--subject-pack",
      snapshotSubjectPack,
      "--profile",
      profileName,
      "--snapshot",
      path.relative(repoRoot, snapshotPath)
    ], browserEnv);

    console.log(`[${packageName}] review: ${path.relative(repoRoot, outputPath)}`);
    removePathRecursive(reviewOutputDir);
    await runNodeScript("review-source-pdf.mjs", [
      path.relative(repoRoot, outputPath),
      "--out",
      path.relative(repoRoot, reviewOutputDir),
      "--scale",
      options.reviewScale
    ], browserEnv);
  } finally {
    if (sharedBrowserServer) {
      await sharedBrowserServer.close().catch(() => {});
    }
  }

  // The repository-local review directory is a transient debugging surface.
  // Keep a delivery-owned copy beside the PDF so archives remain self-contained.
  const deliveryReviewDir = makeDeliveryReviewPath(outputPath);
  removePathRecursive(deliveryReviewDir);
  // On Windows, Node's synchronous recursive copy can terminate the process
  // with STATUS_STACK_BUFFER_OVERRUN for real delivery paths containing CJK
  // names. The asynchronous implementation copies the same tree safely.
  await fsp.cp(reviewOutputDir, deliveryReviewDir, { recursive: true });

  console.log(`[${packageName}] cleanup`);
  if (snapshot.delivery?.rules?.cleanupAfterSuccessfulDeliver !== false) {
    // In-process: the CLI wrapper only adds argv parsing around runCleanup,
    // and each avoided child spawn saves a Node cold start per delivery.
    runCleanup({
      dryRun: false,
      keepReview: true,
      keepOcr: false,
      extraPaths: options.keepReview ? [] : [path.relative(repoRoot, reviewOutputDir)]
    });
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
  // Written only after validate/render/review/cleanup all succeeded: an earlier
  // write would leave an orphan delivery snapshot when a later step fails.
  writeTextFileAtomic(deliverySnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[${packageName}] write-delivery-manifest`);
  await runNodeScript("write-delivery-manifest.mjs", [
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
  // In-process reuse of the exported pure validator: identical checks and
  // failure text as the CLI wrapper, minus one Node cold start per delivery.
  const deliveryManifestPath = makeDeliveryManifestPath(outputPath);
  const manifestErrors = validateDeliveryManifest(
    readJsonFile(deliveryManifestPath),
    deliveryManifestPath
  );
  if (manifestErrors.length > 0) {
    fail(`Delivery manifest validation failed for ${deliveryManifestPath}:\n${manifestErrors.map((error) => `- ${error}`).join("\n")}`, 1);
  }
  console.log(`Validated delivery manifest: ${deliveryManifestPath}`);

  console.log(`[${packageName}] deliver complete: ${path.relative(repoRoot, outputPath)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  // A failed child step keeps its original exit code; anything else is a
  // generic deliver failure.
  process.exit(typeof error?.stepExitCode === "number" ? error.stepExitCode : 2);
}
