import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

const usage = `Usage:
  npm --prefix tools/latex-renderer run visual:compare -- <actual.png> <baseline.png> [--max-diff-ratio 0.005]
`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    maxDiffRatio: 0.005
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--max-diff-ratio") {
      options.maxDiffRatio = Number(argv[++index]);
      continue;
    }

    if (arg.startsWith("--max-diff-ratio=")) {
      options.maxDiffRatio = Number(arg.slice("--max-diff-ratio=".length));
      continue;
    }

    positional.push(arg);
  }

  return { positional, options };
}

async function loadImageData(imagePath) {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, image.width, image.height);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data: imageData.data
  };
}

function compareImageData(actual, baseline) {
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return {
      comparable: false,
      reason: `Image size mismatch: actual ${actual.width}x${actual.height}, baseline ${baseline.width}x${baseline.height}`
    };
  }

  let differentPixels = 0;
  const totalPixels = actual.width * actual.height;

  for (let index = 0; index < actual.data.length; index += 4) {
    const same =
      actual.data[index] === baseline.data[index] &&
      actual.data[index + 1] === baseline.data[index + 1] &&
      actual.data[index + 2] === baseline.data[index + 2] &&
      actual.data[index + 3] === baseline.data[index + 3];

    if (!same) {
      differentPixels += 1;
    }
  }

  return {
    comparable: true,
    differentPixels,
    totalPixels,
    diffRatio: differentPixels / totalPixels
  };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }

  if (positional.length !== 2) {
    fail(usage);
  }

  const actualPath = path.resolve(repoRoot, positional[0]);
  const baselinePath = path.resolve(repoRoot, positional[1]);

  if (!fs.existsSync(actualPath)) {
    fail(`Actual image not found: ${actualPath}`);
  }

  if (!fs.existsSync(baselinePath)) {
    fail(`Baseline image not found: ${baselinePath}`);
  }

  const actual = await loadImageData(actualPath);
  const baseline = await loadImageData(baselinePath);
  const result = compareImageData(actual, baseline);

  if (!result.comparable) {
    fail(result.reason, 1);
  }

  console.log(`Different pixels: ${result.differentPixels}`);
  console.log(`Total pixels: ${result.totalPixels}`);
  console.log(`Diff ratio: ${result.diffRatio}`);

  if (result.diffRatio > options.maxDiffRatio) {
    fail(`Visual regression exceeded threshold ${options.maxDiffRatio}.`, 1);
  }

  console.log("Visual regression passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
});
