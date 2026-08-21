import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadFocusRegionSpec,
  parseFocusRegionSpec,
  resolveFocusRegionPixels,
  sha256File
} from "./focus-region-spec.mjs";

const validSpec = {
  schemaVersion: "1.0",
  sourcePdfSha256: "a".repeat(64),
  regions: [
    {
      id: "q23-figure-25-current-meter",
      label: "Question 23 Figure 25 current meter dial and terminals",
      page: 8,
      questionNumber: 23,
      x: 0.5,
      y: 0.2,
      width: 0.4,
      height: 0.3
    }
  ]
};

test("focus region specification resolves stable page pixels in descriptor order", () => {
  const spec = parseFocusRegionSpec(validSpec);
  const regions = resolveFocusRegionPixels(spec, 8, 2382, 3368);

  assert.deepEqual(regions, [
    {
      ...spec.regions[0],
      focusRegionIndex: 1,
      x: 1191,
      y: 673,
      width: 953,
      height: 1011
    }
  ]);
  assert.deepEqual(resolveFocusRegionPixels(spec, 7, 2382, 3368), []);
});

test("focus region specification rejects answer-like extra fields and out-of-page rectangles", () => {
  assert.throws(
    () => parseFocusRegionSpec({
      ...validSpec,
      regions: [{ ...validSpec.regions[0], expectedAnswer: "0.10 A" }]
    }),
    /unsupported field.*expectedAnswer/u
  );
  assert.throws(
    () => parseFocusRegionSpec({
      ...validSpec,
      regions: [{ ...validSpec.regions[0], x: 0.8, width: 0.3 }]
    }),
    /stay within the page/u
  );
});

test("focus region specification accepts bounded neutral analog-meter calibration", () => {
  const parsed = parseFocusRegionSpec({
    ...validSpec,
    regions: [{
      ...validSpec.regions[0],
      analogMeter: {
        rangeMin: 0,
        rangeMax: 0.6,
        divisions: 30,
        pivotX: 0.55,
        pivotY: 0.35,
        scaleStartAngleDegrees: -150,
        scaleEndAngleDegrees: -30,
        pointerRadiusMin: 0.06,
        pointerRadiusMax: 0.38
      }
    }]
  });

  assert.equal(parsed.regions[0].analogMeter.divisions, 30);
  assert.equal(parsed.regions[0].analogMeter.darkThreshold, 110);
  assert.equal("expectedAnswer" in parsed.regions[0].analogMeter, false);
});

test("focus region specification accepts neutral linear-scale and optical-ray geometry only", () => {
  const parsed = parseFocusRegionSpec({
    ...validSpec,
    regions: [{
      ...validSpec.regions[0],
      linearScale: {
        rangeMin: 50, rangeMax: 60, divisions: 10,
        scaleStartX: 0.5, scaleStartY: 0.8, scaleEndX: 0.5, scaleEndY: 0.2,
        indicatorHalfWidth: 0.02
      },
      opticalRay: {
        lensY: 0.5,
        beforeLeft: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.4 },
        beforeRight: { x1: 0.9, y1: 0.1, x2: 0.7, y2: 0.4 },
        afterLeft: { x1: 0.4, y1: 0.6, x2: 0.48, y2: 0.8 },
        afterRight: { x1: 0.6, y1: 0.6, x2: 0.52, y2: 0.8 }
      }
    }]
  });
  assert.equal(parsed.regions[0].linearScale.darkThreshold, 90);
  assert.equal(parsed.regions[0].opticalRay.lineHalfWidth, 0.004);
  assert.throws(
    () => parseFocusRegionSpec({
      ...validSpec,
      regions: [{
        ...validSpec.regions[0],
        linearScale: {
          rangeMin: 50, rangeMax: 60, divisions: 10,
          scaleStartX: 0.5, scaleStartY: 0.8, scaleEndX: 0.5, scaleEndY: 0.2,
          indicatorHalfWidth: 0.02, expectedAnswer: 58
        }
      }]
    }),
    /unsupported field.*expectedAnswer/u
  );
});

test("focus region specification accepts a perpendicular-stroke scale mode without answer fields", () => {
  const parsed = parseFocusRegionSpec({
    ...validSpec,
    regions: [{
      ...validSpec.regions[0],
      linearScale: {
        rangeMin: 2, rangeMax: 3, divisions: 10,
        scaleStartX: 0.5, scaleStartY: 0.2, scaleEndX: 0.5, scaleEndY: 0.8,
        indicatorHalfWidth: 0.02,
        indicatorMode: "perpendicular-stroke",
        indicatorSearchHalfWidth: 0.12
      }
    }]
  });
  assert.equal(parsed.regions[0].linearScale.indicatorMode, "perpendicular-stroke");
  assert.equal("expectedAnswer" in parsed.regions[0].linearScale, false);
});

test("focus region file is bound to the exact source PDF bytes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-focus-regions-"));
  const sourcePdfPath = path.join(directory, "source.pdf");
  const specPath = path.join(directory, "regions.json");
  try {
    writeFileSync(sourcePdfPath, "frozen source bytes", "utf8");
    const sourcePdfSha256 = sha256File(sourcePdfPath);
    writeFileSync(specPath, JSON.stringify({ ...validSpec, sourcePdfSha256 }), "utf8");

    const loaded = loadFocusRegionSpec(specPath, sourcePdfPath);
    assert.equal(loaded.sourcePdfSha256, sourcePdfSha256);
    assert.equal(loaded.filePath, specPath);

    writeFileSync(sourcePdfPath, "drifted source bytes", "utf8");
    assert.throws(() => loadFocusRegionSpec(specPath, sourcePdfPath), /source PDF hash mismatch/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
