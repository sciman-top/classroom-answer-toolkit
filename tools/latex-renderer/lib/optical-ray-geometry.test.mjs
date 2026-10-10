import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOpticalRayCanvas } from "./optical-ray-geometry.mjs";

function drawLine(data, width, height, segment) {
  const x1 = segment.x1 * width; const y1 = segment.y1 * height;
  const x2 = segment.x2 * width; const y2 = segment.y2 * height;
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + (x2 - x1) * step / steps);
    const y = Math.round(y1 + (y2 - y1) * step / steps);
    for (let dx = -2; dx <= 2; dx += 1) for (let dy = -2; dy <= 2; dy += 1) {
      const offset = ((y + dy) * width + x + dx) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
}

const rays = {
  beforeLeft: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.45 },
  beforeRight: { x1: 0.8, y1: 0.2, x2: 0.6, y2: 0.45 },
  afterLeft: { x1: 0.43, y1: 0.55, x2: 0.48, y2: 0.75 },
  afterRight: { x1: 0.57, y1: 0.55, x2: 0.52, y2: 0.75 }
};

test("optical ray geometry reports weaker convergence from verified source lines", () => {
  const width = 500; const height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  Object.values(rays).forEach((segment) => drawLine(data, width, height, segment));
  globalThis.window = { pdfReview: { focusCanvases: { rays: {
    width, height, getContext: () => ({ getImageData: () => ({ data }) })
  } } } };
  try {
    const result = analyzeOpticalRayCanvas({ regionId: "rays", lensY: 0.5, ...rays, lineHalfWidth: 0.01, darkThreshold: 90 });
    assert.equal(result.status, "measured");
    assert.equal(result.relation, "converging_less");
  } finally { delete globalThis.window; }
});

test("optical ray geometry fails closed when any required ray is absent", () => {
  const width = 500; const height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  Object.values(rays).slice(0, 3).forEach((segment) => drawLine(data, width, height, segment));
  globalThis.window = { pdfReview: { focusCanvases: { rays: {
    width, height, getContext: () => ({ getImageData: () => ({ data }) })
  } } } };
  try {
    const result = analyzeOpticalRayCanvas({ regionId: "rays", lensY: 0.5, ...rays, lineHalfWidth: 0.01, darkThreshold: 90 });
    assert.equal(result.status, "uncertain");
    assert.equal(result.relation, null);
  } finally { delete globalThis.window; }
});

test("optical ray geometry fails closed when a competing parallel line is present", () => {
  const width = 500; const height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  Object.values(rays).forEach((segment) => drawLine(data, width, height, segment));
  drawLine(data, width, height, {
    x1: rays.afterRight.x1 + 0.035, y1: rays.afterRight.y1,
    x2: rays.afterRight.x2 + 0.035, y2: rays.afterRight.y2
  });
  globalThis.window = { pdfReview: { focusCanvases: { rays: {
    width, height, getContext: () => ({ getImageData: () => ({ data }) })
  } } } };
  try {
    const result = analyzeOpticalRayCanvas({ regionId: "rays", lensY: 0.5, ...rays, lineHalfWidth: 0.01, darkThreshold: 90 });
    assert.equal(result.status, "uncertain");
    assert.equal(result.relation, null);
  } finally { delete globalThis.window; }
});
