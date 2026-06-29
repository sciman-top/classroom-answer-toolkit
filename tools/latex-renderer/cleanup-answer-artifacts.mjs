import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

const usage = `Usage:
  npm --prefix tools/latex-renderer run cleanup -- [--dry-run] [--keep-review] [--keep-ocr] [extra-path...]

Examples:
  npm --prefix tools/latex-renderer run cleanup --
  npm --prefix tools/latex-renderer run cleanup -- --dry-run
  npm --prefix tools/latex-renderer run cleanup -- .pdf-review/某套试卷 _ocr_work/某套试卷

Behavior:
  - Deletes repository-local transient artifacts created during source review, OCR, and visual QA.
  - Keeps final deliverables such as source PDFs, answer Markdown, answer PDFs, and tool dependencies.
  - Preserves everything when render/review fails unless you run this cleanup command explicitly.
  - Loose temp files such as *.render.html are deleted only when passed explicitly.
`;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    keepReview: false,
    keepOcr: false,
    extraPaths: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--keep-review") {
      options.keepReview = true;
      continue;
    }

    if (arg === "--keep-ocr") {
      options.keepOcr = true;
      continue;
    }

    options.extraPaths.push(arg);
  }

  return options;
}

function isWithinRepo(candidatePath) {
  const relative = path.relative(repoRoot, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isAllowedExtraPath(candidatePath) {
  const normalized = candidatePath.toLowerCase();
  const baseName = path.basename(candidatePath).toLowerCase();

  return (
    normalized.includes(`${path.sep}.pdf-review${path.sep}`) ||
    normalized.endsWith(`${path.sep}.pdf-review`) ||
    normalized.includes(`${path.sep}_ocr_work${path.sep}`) ||
    normalized.endsWith(`${path.sep}_ocr_work`) ||
    baseName.startsWith("_tmp_") ||
    baseName.endsWith(".render.html")
  );
}

function resolveExtraPath(rawPath) {
  const resolved = path.resolve(repoRoot, rawPath);

  if (!fs.existsSync(resolved)) {
    return null;
  }

  if (!isWithinRepo(resolved)) {
    throw new Error(`Refusing to delete path outside repository: ${rawPath}`);
  }

  if (!isAllowedExtraPath(resolved)) {
    throw new Error(`Refusing to delete non-temporary path: ${rawPath}`);
  }

  return resolved;
}

function collectCandidates(options) {
  const candidates = [];

  if (!options.keepReview) {
    const reviewDir = path.join(repoRoot, ".pdf-review");
    if (fs.existsSync(reviewDir)) {
      candidates.push(reviewDir);
    }
  }

  if (!options.keepOcr) {
    const ocrDir = path.join(repoRoot, "_ocr_work");
    if (fs.existsSync(ocrDir)) {
      candidates.push(ocrDir);
    }
  }

  for (const rawPath of options.extraPaths) {
    const resolved = resolveExtraPath(rawPath);
    if (resolved) {
      candidates.push(resolved);
    }
  }

  return [...new Set(candidates)].sort((left, right) => right.length - left.length);
}

function removePath(targetPath, dryRun) {
  const stat = fs.lstatSync(targetPath);
  const kind = stat.isDirectory() ? "dir" : "file";
  const relative = path.relative(repoRoot, targetPath);

  if (dryRun) {
    console.log(`[dry-run] remove ${kind}: ${relative}`);
    return { removed: false, kind };
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`removed ${kind}: ${relative}`);
  return { removed: true, kind };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage);
    process.exit(0);
  }

  const candidates = collectCandidates(options);

  if (candidates.length === 0) {
    console.log("No transient artifacts found.");
    process.exit(0);
  }

  let removedFiles = 0;
  let removedDirs = 0;

  for (const candidate of candidates) {
    const { kind } = removePath(candidate, options.dryRun);
    if (kind === "dir") {
      removedDirs += 1;
    } else {
      removedFiles += 1;
    }
  }

  const action = options.dryRun ? "Would remove" : "Removed";
  console.log(`${action} ${removedDirs} director${removedDirs === 1 ? "y" : "ies"} and ${removedFiles} file${removedFiles === 1 ? "" : "s"}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
