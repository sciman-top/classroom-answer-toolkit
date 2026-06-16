import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultProfileName, loadRuntimeConfig } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const packageJsonPath = path.join(toolDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = packageJson.name ?? "physics-answer-latex-renderer";
const runtimeConfig = loadRuntimeConfig();

const usage = `Usage:
  npm --prefix tools/latex-renderer run deliver -- <answer.md> [output.pdf] [--profile classroom|compact] [--keep-review] [--keep-ocr] [--review-scale 2] [--skip-validate]

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
  return path.join(toolDir, scriptFileName);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    profile: getDefaultProfileName(),
    keepReview: false,
    keepOcr: false,
    reviewScale: "2",
    skipValidate: false
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

    if (arg === "--review-scale") {
      options.reviewScale = argv[++index];
      continue;
    }

    if (arg.startsWith("--review-scale=")) {
      options.reviewScale = arg.slice("--review-scale=".length);
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

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));

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

  if (!options.skipValidate) {
    console.log(`[${packageName}] validate: ${path.relative(repoRoot, inputPath)}`);
    runNodeScript("validate-answer-markdown.mjs", [
      path.relative(repoRoot, inputPath),
      "--profile",
      options.profile
    ]);
  }

  console.log(`[${packageName}] render: ${path.relative(repoRoot, inputPath)}`);
  runNodeScript("render-md-latex.mjs", [
    path.relative(repoRoot, inputPath),
    path.relative(repoRoot, outputPath),
    "--profile",
    options.profile
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
  if (options.keepReview) {
    cleanupArgs.push("--keep-review");
  }
  if (options.keepOcr) {
    cleanupArgs.push("--keep-ocr");
  }

  console.log(`[${packageName}] cleanup`);
  if (runtimeConfig.deliveryRules?.cleanupAfterSuccessfulDeliver !== false) {
    runNodeScript("cleanup-answer-artifacts.mjs", cleanupArgs);
  } else {
    console.log(`[${packageName}] cleanup skipped by runtime config`);
  }

  console.log(`[${packageName}] deliver complete: ${path.relative(repoRoot, outputPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
