import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLinearScaleCanvas } from "./linear-scale-reading.mjs";

function canvasWithVerticalIndicator({ width = 300, height = 500, top = 170, bottom = 350, competing = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 100; y <= 350; y += 1) {
    for (let x = 148; x <= 152; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  for (let y = top; y <= bottom; y += 1) {
    for (let x = 138; x <= 162; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  if (competing) {
    for (let y = 100; y <= 150; y += 1) {
      for (let x = 138; x <= 162; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = 0;
      }
    }
  }
  return { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
}

const config = {
  regionId: "scale", rangeMin: 50, rangeMax: 60, divisions: 10,
  scaleStartX: 0.5, scaleStartY: 0.7, scaleEndX: 0.5, scaleEndY: 0.2,
  indicatorHalfWidth: 0.05, darkThreshold: 80
};

test("linear scale emits only the nearest calibrated division", () => {
  globalThis.window = { pdfReview: { focusCanvases: { scale: canvasWithVerticalIndicator() } } };
  try {
    const result = analyzeLinearScaleCanvas(config);
    assert.equal(result.status, "measured");
    assert.equal(result.nearestDivision, 7);
    assert.equal(result.value, 57);
  } finally { delete globalThis.window; }
});

test("linear scale fails closed for disconnected competing dark bands", () => {
  globalThis.window = { pdfReview: { focusCanvases: { scale: canvasWithVerticalIndicator({ competing: true }) } } };
  try {
    const result = analyzeLinearScaleCanvas(config);
    assert.equal(result.status, "uncertain");
    assert.equal(result.value, null);
  } finally { delete globalThis.window; }
});

test("linear scale measures a perpendicular pointer stroke at a calibrated division", () => {
  const width = 400;
  const height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 100; y <= 400; y += 1) {
    for (let x = 198; x <= 202; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  for (let x = 150; x <= 250; x += 1) {
    const offset = (220 * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = 0;
  }
  globalThis.window = { pdfReview: { focusCanvases: {
    pointer: { width, height, getContext: () => ({ getImageData: () => ({ data }) }) }
  } } };
  try {
    const result = analyzeLinearScaleCanvas({
      regionId: "pointer", rangeMin: 2, rangeMax: 3, divisions: 10,
      scaleStartX: 0.5, scaleStartY: 0.2, scaleEndX: 0.5, scaleEndY: 0.8,
      indicatorHalfWidth: 0.02, indicatorMode: "perpendicular-stroke",
      indicatorSearchHalfWidth: 0.2, minimumStrokeCoverage: 0.55, competitionGap: 0.08,
      darkThreshold: 80
    });
    assert.equal(result.status, "measured");
    assert.equal(result.nearestDivision, 4);
    assert.equal(result.value, 2.4);
  } finally { delete globalThis.window; }
});

test("perpendicular-stroke scale fails closed for a competing full-width pointer", () => {
  const width = 400;
  const height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of [220, 310]) {
    for (let x = 150; x <= 250; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  globalThis.window = { pdfReview: { focusCanvases: {
    competing: { width, height, getContext: () => ({ getImageData: () => ({ data }) }) }
  } } };
  try {
    const result = analyzeLinearScaleCanvas({
      regionId: "competing", rangeMin: 2, rangeMax: 3, divisions: 10,
      scaleStartX: 0.5, scaleStartY: 0.2, scaleEndX: 0.5, scaleEndY: 0.8,
      indicatorHalfWidth: 0.02, indicatorMode: "perpendicular-stroke",
      indicatorSearchHalfWidth: 0.2, minimumStrokeCoverage: 0.55, competitionGap: 0.08,
      darkThreshold: 80
    });
    assert.equal(result.status, "uncertain");
    assert.equal(result.value, null);
  } finally { delete globalThis.window; }
});
