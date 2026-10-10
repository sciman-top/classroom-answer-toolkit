import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fail, parseArgvFlags, repositoryRoot as repoRoot } from "../shared.mjs";

const usage = `Usage:
  npm --prefix tools/latex-renderer run visual:compare -- <actual.png> <baseline.png> [--max-diff-ratio 0.005] [--channel-tolerance 32]

Options:
  --max-diff-ratio      Maximum share of pixels allowed to differ (default 0.005).
  --channel-tolerance   Per-channel byte delta ignored as rasterization noise
                        (default 32; pass 0 for an exact-equality comparison).
`;

export function parseArgs(argv) {
  const { options, positional } = parseArgvFlags(argv, {
    stringFlags: { "max-diff-ratio": "maxDiffRatio", "channel-tolerance": "channelTolerance" },
    defaults: { maxDiffRatio: 0.005, channelTolerance: 32 },
    help: true,
    unknownFlag: "positional",
    positional: true
  });
  if (typeof options.maxDiffRatio === "string") {
    options.maxDiffRatio = Number(options.maxDiffRatio);
  }
  if (typeof options.channelTolerance === "string") {
    options.channelTolerance = Number(options.channelTolerance);
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

/**
 * Compares two decoded page images.
 *
 * A pixel only counts as different when some channel differs by more than
 * `channelTolerance`. Exact equality is the wrong default for this gate: the
 * same page rendered on two machines differs on ~75% of its differing pixels by
 * only 1-16/255, purely from font antialiasing and browser rasterization. With
 * tolerance 0 those pixels alone pushed a clean render to a 0.85% diff, while a
 * genuine layout regression (a shifted block of text) measured 1.7% and is
 * almost unaffected by the tolerance (1.7% -> 1.6% at tolerance 32). The
 * tolerance therefore removes environment noise without weakening the gate:
 * measured separation on the real cases is 0.20% noise vs 1.57% regression
 * against a 0.5% threshold.
 */
export function compareImageData(actual, baseline, channelTolerance = 0) {
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return {
      comparable: false,
      reason: `Image size mismatch: actual ${actual.width}x${actual.height}, baseline ${baseline.width}x${baseline.height}`
    };
  }

  let differentPixels = 0;
  let rawDifferentPixels = 0;
  const totalPixels = actual.width * actual.height;

  for (let index = 0; index < actual.data.length; index += 4) {
    let maxDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(actual.data[index + channel] - baseline.data[index + channel]);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    }

    if (maxDelta > 0) {
      rawDifferentPixels += 1;
    }
    if (maxDelta > channelTolerance) {
      differentPixels += 1;
    }
  }

  return {
    comparable: true,
    differentPixels,
    rawDifferentPixels,
    totalPixels,
    diffRatio: differentPixels / totalPixels,
    rawDiffRatio: rawDifferentPixels / totalPixels,
    channelTolerance
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

  if (!Number.isFinite(options.maxDiffRatio) || options.maxDiffRatio < 0 || options.maxDiffRatio > 1) {
    fail(`--max-diff-ratio must be a number between 0 and 1, got ${JSON.stringify(options.maxDiffRatio)}.\n${usage}`);
  }

  if (!Number.isInteger(options.channelTolerance) || options.channelTolerance < 0 || options.channelTolerance > 255) {
    fail(`--channel-tolerance must be an integer between 0 and 255, got ${JSON.stringify(options.channelTolerance)}.\n${usage}`);
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
  const result = compareImageData(actual, baseline, options.channelTolerance);

  if (!result.comparable) {
    fail(result.reason, 1);
  }

  console.log(`Different pixels: ${result.differentPixels}`);
  console.log(`Total pixels: ${result.totalPixels}`);
  console.log(`Diff ratio: ${result.diffRatio}`);
  console.log(
    `Raw differing pixels (any channel delta): ${result.rawDifferentPixels} (${result.rawDiffRatio.toFixed(6)})`
    + `; ignored as rasterization noise at tolerance ${result.channelTolerance}`
  );

  if (result.diffRatio > options.maxDiffRatio) {
    fail(`Visual regression exceeded threshold ${options.maxDiffRatio}.`, 1);
  }

  console.log("Visual regression passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
}
