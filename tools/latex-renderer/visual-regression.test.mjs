import assert from "node:assert/strict";
import test from "node:test";

import { compareImageData, parseArgs } from "./visual-regression.mjs";

// These tests are deliberately in-process: compareImageData takes plain
// {width,height,data} objects, so the gate's arithmetic is covered without
// launching a browser or a child process.
function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b, a] = pixel;
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = a;
  }
  return { width, height, data };
}

test("identical images report no difference", () => {
  const actual = image(4, 4, [255, 255, 255, 255]);
  const baseline = image(4, 4, [255, 255, 255, 255]);

  const result = compareImageData(actual, baseline, 32);

  assert.equal(result.comparable, true);
  assert.equal(result.differentPixels, 0);
  assert.equal(result.rawDifferentPixels, 0);
  assert.equal(result.diffRatio, 0);
});

test("antialiasing-level deltas are ignored at the default tolerance", () => {
  // One pixel differs by 16/255 on a single channel: the signature of font
  // rasterization noise, which must not fail the gate.
  const actual = image(2, 2, [255, 255, 255, 255]);
  const baseline = image(2, 2, [255, 255, 255, 255]);
  actual.data[0] = 239;

  const result = compareImageData(actual, baseline, 32);

  assert.equal(result.rawDifferentPixels, 1, "the raw count still sees the pixel");
  assert.equal(result.differentPixels, 0, "the gated count must ignore it");
  assert.equal(result.diffRatio, 0);
});

test("ink-versus-paper deltas are counted as real differences", () => {
  // Same page, one glyph covered in ink instead of paper.
  const actual = image(2, 2, [255, 255, 255, 255]);
  const baseline = image(2, 2, [255, 255, 255, 255]);
  actual.data[4] = 0;
  actual.data[5] = 0;
  actual.data[6] = 0;

  const result = compareImageData(actual, baseline, 32);

  assert.equal(result.differentPixels, 1);
  assert.equal(result.diffRatio, 0.25);
});

test("tolerance zero reproduces exact-equality semantics", () => {
  const actual = image(2, 2, [255, 255, 255, 255]);
  const baseline = image(2, 2, [255, 255, 255, 255]);
  actual.data[0] = 254;

  assert.equal(compareImageData(actual, baseline, 0).differentPixels, 1);
  assert.equal(compareImageData(actual, baseline, 1).differentPixels, 0);
});

test("a size mismatch is reported instead of compared", () => {
  const result = compareImageData(
    image(2, 2, [0, 0, 0, 255]),
    image(3, 2, [0, 0, 0, 255]),
    32
  );

  assert.equal(result.comparable, false);
  assert.match(result.reason, /Image size mismatch/);
});

test("the CLI defaults to a 32 channel tolerance and a 0.005 ratio budget", () => {
  const { options, positional } = parseArgs(["a.png", "b.png"]);

  assert.deepEqual(positional, ["a.png", "b.png"]);
  assert.equal(options.channelTolerance, 32);
  assert.equal(options.maxDiffRatio, 0.005);
});

test("the CLI parses an explicit tolerance and ratio", () => {
  const { options } = parseArgs(["a.png", "b.png", "--channel-tolerance", "0", "--max-diff-ratio", "0.01"]);

  assert.equal(options.channelTolerance, 0);
  assert.equal(options.maxDiffRatio, 0.01);
});
