import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultProfileName, getDefaultSubjectPack, loadRuntimeConfig, resolveSnapshotPath } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const packageJsonPath = path.join(toolDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = packageJson.name ?? "physics-answer-latex-renderer";

const usage = `Usage:
  npm --prefix tools/latex-renderer run deliver -- <answer.md> [output.pdf] [--profile classroom|compact] [--snapshot-path <snapshot.json>] [--keep-review] [--keep-ocr] [--review-scale 2] [--skip-validate]

Examples:
  npm --prefix tools/latex-renderer run deliver -- "习题PDF/能量-效率参考答案.md"
  npm --prefix tools/latex-renderer run deliver -- "习题PDF/能量-效率参考答案.md" --keep-review

Behavior:
  1. Render the answer Markdown to PDF.
  2. Render the answer PDF into review page images for visual QA.
  3. If both steps succeed, automatically clean transient artifacts unless you keep them.
  4. If any step fails, keep all temporary artifacts for debugging.
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
  const positional = [];
  const options = {
    profile: null,
    snapshotPath: null,
    keepReview: false,
    keepOcr: false,
    reviewScale: "2",
    skipValidate: false,
    subjectPack: getDefaultSubjectPack()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--keep-review") {
      options.keepReview = true;
      continue;
    }

    if (arg === "--skip-validate") {
      options.skipValidate = true;
      continue;
    }

    if (arg === "--keep-ocr") {
      options.keepOcr = true;
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

    if (arg === "--snapshot-path") {
      options.snapshotPath = argv[++index];
      continue;
    }

    if (arg.startsWith("--snapshot-path=")) {
      options.snapshotPath = arg.slice("--snapshot-path=".length);
      continue;
    }

    if (arg === "--review-scale") {
      options.reviewScale = argv[++index];
      continue;
    }

    if (arg.startsWith("--review-scale=")) {
      options.reviewScale = arg.slice("--review-scale=".length);
      continue;
    }

    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }

    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }

    positional.push(arg);
  }

  return { positional, options };
}

function runNodeScript(scriptFileName, scriptArgs) {
  const filteredArgs = scriptArgs.filter((value) => value !== undefined && value !== null && value !== "");
  const result = spawnSync(
    process.execPath,
    [resolveToolScript(scriptFileName), ...filteredArgs],
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

function makeReviewOutputDir(pdfPath) {
  const relativePdfPath = path.relative(repoRoot, pdfPath);
  const safeName = path.basename(pdfPath, path.extname(pdfPath));
  const parentFragment = path
    .dirname(relativePdfPath)
    .replace(/[\\/]+/g, "__")
    .replace(/^\.+/, "")
    .replace(/^__+/, "");

  const folderName = parentFragment && parentFragment !== "."
    ? `${parentFragment}__${safeName}`
    : safeName;

  return path.join(repoRoot, ".pdf-review", folderName);
}

function makeDeliveryManifestPath(pdfPath) {
  return path.resolve(
    path.dirname(pdfPath),
    `${path.basename(pdfPath, path.extname(pdfPath))}.delivery-manifest.json`
  );
}

function makeRenderTempHtmlPath(pdfPath) {
  return path.resolve(
    path.dirname(pdfPath),
    `.${path.basename(pdfPath, ".pdf")}.render.html`
  );
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const runtimeConfig = loadRuntimeConfig(options.subjectPack);
  const callerCwd = process.env.INIT_CWD || process.cwd();

  if (!options.profile) {
    options.profile = getDefaultProfileName(options.subjectPack);
  }

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

  const reviewOutputDir = makeReviewOutputDir(outputPath);
  const snapshotPath = resolveSnapshotPath(options.snapshotPath, {
    subjectPack: options.subjectPack,
    callerCwd
  });

  console.log(`[${packageName}] validate-assets`);
  runNodeScript(path.join("..", "rule-compiler", "validate-assets.mjs"), []);

  if (!options.snapshotPath) {
    console.log(`[${packageName}] compile-snapshot`);
    runNodeScript(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
      "--subject-pack",
      options.subjectPack,
      "--profile",
      options.profile,
      "--out",
      path.relative(repoRoot, snapshotPath)
    ]);
  } else {
    console.log(`[${packageName}] reuse snapshot`);
  }

  if (!fs.existsSync(snapshotPath)) {
    fail(`Resolved snapshot not found: ${snapshotPath}`);
  }

  const snapshot = loadJson(snapshotPath);

  if (!options.skipValidate) {
    console.log(`[${packageName}] validate: ${path.relative(repoRoot, inputPath)}`);
    runNodeScript("validate-answer-markdown.mjs", [
      path.relative(repoRoot, inputPath),
      "--subject-pack",
      options.subjectPack,
      "--profile",
      options.profile,
      "--snapshot",
      path.relative(repoRoot, snapshotPath)
    ]);
  }

  console.log(`[${packageName}] render: ${path.relative(repoRoot, inputPath)}`);
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, inputPath),
    path.relative(repoRoot, outputPath),
    "--subject-pack",
    options.subjectPack,
    "--profile",
    options.profile,
    "--snapshot",
    path.relative(repoRoot, snapshotPath)
  ]);

  console.log(`[${packageName}] review: ${path.relative(repoRoot, outputPath)}`);
  runNodeScript("review-source-pdf.mjs", [
    path.relative(repoRoot, outputPath),
    "--out",
    path.relative(repoRoot, reviewOutputDir),
    "--scale",
    options.reviewScale
  ]);

  const cleanupArgs = [];
  if (options.keepOcr) {
    cleanupArgs.push("--keep-ocr");
  }
  cleanupArgs.push("--keep-review");
  if (!options.keepReview) {
    cleanupArgs.push(path.relative(repoRoot, reviewOutputDir));
  }
  cleanupArgs.push(path.relative(repoRoot, makeRenderTempHtmlPath(outputPath)));

  console.log(`[${packageName}] cleanup`);
  if (runtimeConfig.deliveryRules?.cleanupAfterSuccessfulDeliver !== false) {
    runNodeScript("cleanup-answer-artifacts.mjs", cleanupArgs);
    if (!options.keepReview) {
      const reviewRoot = path.join(repoRoot, ".pdf-review");
      if (fs.existsSync(reviewRoot) && fs.readdirSync(reviewRoot).length === 0) {
        fs.rmSync(reviewRoot, { recursive: true, force: true });
      }
    }
  } else {
    console.log(`[${packageName}] cleanup skipped by runtime config`);
  }

  const reviewManifestPath = path.join(reviewOutputDir, "manifest.json");
  console.log(`[${packageName}] write-delivery-manifest`);
  runNodeScript("write-delivery-manifest.mjs", [
    "--input",
    path.relative(repoRoot, inputPath),
    "--output",
    path.relative(repoRoot, outputPath),
    "--subject-pack",
    options.subjectPack,
    "--profile",
    options.profile,
    "--snapshot-path",
    path.relative(repoRoot, snapshotPath),
    "--snapshot-id",
    snapshot.snapshotId,
    "--review-dir",
    path.relative(repoRoot, reviewOutputDir),
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
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
