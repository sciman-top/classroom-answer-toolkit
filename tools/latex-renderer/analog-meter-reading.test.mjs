import assert from "node:assert/strict";
import test from "node:test";

import { analyzeAnalogMeterCanvas } from "./analog-meter-reading.mjs";

function drawLine(data, width, height, fromX, fromY, toX, toY, thickness = 5) {
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY));
  for (let step = 0; step <= steps; step += 1) {
    const x = fromX + (toX - fromX) * step / steps;
    const y = fromY + (toY - fromY) * step / steps;
    for (let dx = -thickness; dx <= thickness; dx += 1) {
      for (let dy = -thickness; dy <= thickness; dy += 1) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || px >= width || py < 0 || py >= height) {
          continue;
        }
        const offset = (py * width + px) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 255;
      }
    }
  }
}

test("analog meter geometry measures the nearest calibrated division from the pointer ray", () => {
  const width = 600;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pivotX = 300;
  const pivotY = 420;
  const pointerAngle = -130;
  const radians = pointerAngle * Math.PI / 180;
  drawLine(
    data,
    width,
    height,
    pivotX,
    pivotY,
    pivotX + 260 * Math.cos(radians),
    pivotY + 260 * Math.sin(radians),
    4
  );
  const canvas = {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data }) })
  };
  globalThis.window = { pdfReview: { focusCanvases: { meter: canvas } } };
  try {
    const result = analyzeAnalogMeterCanvas({
      regionId: "meter",
      rangeMin: 0,
      rangeMax: 0.6,
      divisions: 30,
      pivotX: pivotX / width,
      pivotY: pivotY / height,
      scaleStartAngleDegrees: -150,
      scaleEndAngleDegrees: -30,
      pointerRadiusMin: 0.08,
      pointerRadiusMax: 0.40
    });

    assert.equal(result.status, "measured");
    assert.equal(result.nearestDivision, 5);
    assert.equal(result.value, 0.1);
    assert.ok(result.pointerLineCoverage > 0.9);
  } finally {
    delete globalThis.window;
  }
});

test("analog meter geometry fails closed when a competing radial line matches the pointer coverage", () => {
  const width = 600;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pivotX = 300;
  const pivotY = 420;
  const drawRadial = (angleDegrees) => {
    const radians = angleDegrees * Math.PI / 180;
    drawLine(
      data,
      width,
      height,
      pivotX,
      pivotY,
      pivotX + 260 * Math.cos(radians),
      pivotY + 260 * Math.sin(radians),
      4
    );
  };
  drawRadial(-90); // Pointer at division 15: true reading 0.3 A.
  drawRadial(-122); // Full-length competing radial line at division 7 (0.14 A if trusted).
  const canvas = {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data }) })
  };
  globalThis.window = { pdfReview: { focusCanvases: { meter: canvas } } };
  try {
    const result = analyzeAnalogMeterCanvas({
      regionId: "meter",
      rangeMin: 0,
      rangeMax: 0.6,
      divisions: 30,
      pivotX: pivotX / width,
      pivotY: pivotY / height,
      scaleStartAngleDegrees: -150,
      scaleEndAngleDegrees: -30,
      pointerRadiusMin: 0.08,
      pointerRadiusMax: 0.40
    });

    assert.equal(result.status, "uncertain");
    assert.equal(result.value, null);
    assert.ok(result.competingLineCoverage >= 0.9);
  } finally {
    delete globalThis.window;
  }
});

test("analog meter geometry fails closed when no continuous pointer ray is present", () => {
  const width = 300;
  const height = 300;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  globalThis.window = {
    pdfReview: {
      focusCanvases: {
        blank: { width, height, getContext: () => ({ getImageData: () => ({ data }) }) }
      }
    }
  };
  try {
    const result = analyzeAnalogMeterCanvas({
      regionId: "blank",
      rangeMin: 0,
      rangeMax: 1,
      divisions: 10,
      pivotX: 0.5,
      pivotY: 0.7,
      scaleStartAngleDegrees: -150,
      scaleEndAngleDegrees: -30,
      pointerRadiusMin: 0.05,
      pointerRadiusMax: 0.4
    });
    assert.equal(result.status, "uncertain");
    assert.equal(result.value, null);
  } finally {
    delete globalThis.window;
  }
});
