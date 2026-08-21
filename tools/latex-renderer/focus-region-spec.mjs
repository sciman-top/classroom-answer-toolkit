import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT_FIELDS = new Set(["schemaVersion", "sourcePdfSha256", "regions"]);
const REGION_FIELDS = new Set([
  "id",
  "label",
  "page",
  "questionNumber",
  "x",
  "y",
  "width",
  "height",
  "analogMeter",
  "linearScale",
  "opticalRay"
]);
const ANALOG_METER_FIELDS = new Set([
  "rangeMin",
  "rangeMax",
  "divisions",
  "pivotX",
  "pivotY",
  "scaleStartAngleDegrees",
  "scaleEndAngleDegrees",
  "pointerRadiusMin",
  "pointerRadiusMax",
  "darkThreshold"
]);
const LINEAR_SCALE_FIELDS = new Set([
  "rangeMin", "rangeMax", "divisions",
  "scaleStartX", "scaleStartY", "scaleEndX", "scaleEndY",
  "indicatorHalfWidth", "indicatorMode", "indicatorSearchHalfWidth",
  "minimumStrokeCoverage", "competitionGap", "darkThreshold"
]);
const OPTICAL_RAY_FIELDS = new Set([
  "lensY", "beforeLeft", "beforeRight", "afterLeft", "afterRight",
  "lineHalfWidth", "darkThreshold"
]);
const LINE_SEGMENT_FIELDS = new Set(["x1", "y1", "x2", "y2"]);
const MAX_REGIONS = 24;

function assertPlainObject(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }
}

function assertKnownFields(value, allowedFields, description) {
  const unknown = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknown.length > 0) {
    throw new Error(`${description} contains unsupported field(s): ${unknown.join(", ")}.`);
  }
}

function assertNormalizedNumber(value, field, regionId) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Focus region ${regionId} field ${field} must be a number from 0 to 1.`);
  }
}

function parseAnalogMeter(value, regionId) {
  if (value === undefined) {
    return null;
  }
  assertPlainObject(value, `Focus region ${regionId} analogMeter`);
  assertKnownFields(value, ANALOG_METER_FIELDS, `Focus region ${regionId} analogMeter`);
  if (!Number.isFinite(value.rangeMin) || !Number.isFinite(value.rangeMax) || value.rangeMax <= value.rangeMin) {
    throw new Error(`Focus region ${regionId} analogMeter rangeMax must be greater than rangeMin.`);
  }
  if (!Number.isInteger(value.divisions) || value.divisions < 1 || value.divisions > 100) {
    throw new Error(`Focus region ${regionId} analogMeter divisions must be an integer from 1 to 100.`);
  }
  for (const field of ["pivotX", "pivotY", "pointerRadiusMin", "pointerRadiusMax"]) {
    assertNormalizedNumber(value[field], `analogMeter.${field}`, regionId);
  }
  if (value.pointerRadiusMin >= value.pointerRadiusMax) {
    throw new Error(`Focus region ${regionId} analogMeter pointerRadiusMax must exceed pointerRadiusMin.`);
  }
  for (const field of ["scaleStartAngleDegrees", "scaleEndAngleDegrees"]) {
    if (!Number.isFinite(value[field]) || value[field] < -180 || value[field] > 180) {
      throw new Error(`Focus region ${regionId} analogMeter ${field} must be from -180 to 180 degrees.`);
    }
  }
  if (value.scaleEndAngleDegrees <= value.scaleStartAngleDegrees) {
    throw new Error(`Focus region ${regionId} analogMeter scale angles must increase from start to end.`);
  }
  if (value.darkThreshold !== undefined
      && (!Number.isInteger(value.darkThreshold) || value.darkThreshold < 0 || value.darkThreshold > 255)) {
    throw new Error(`Focus region ${regionId} analogMeter darkThreshold must be an integer from 0 to 255.`);
  }
  return {
    rangeMin: value.rangeMin,
    rangeMax: value.rangeMax,
    divisions: value.divisions,
    pivotX: value.pivotX,
    pivotY: value.pivotY,
    scaleStartAngleDegrees: value.scaleStartAngleDegrees,
    scaleEndAngleDegrees: value.scaleEndAngleDegrees,
    pointerRadiusMin: value.pointerRadiusMin,
    pointerRadiusMax: value.pointerRadiusMax,
    darkThreshold: value.darkThreshold ?? 110
  };
}

function parseLinearScale(value, regionId) {
  if (value === undefined) return null;
  assertPlainObject(value, `Focus region ${regionId} linearScale`);
  assertKnownFields(value, LINEAR_SCALE_FIELDS, `Focus region ${regionId} linearScale`);
  if (!Number.isFinite(value.rangeMin) || !Number.isFinite(value.rangeMax) || value.rangeMax <= value.rangeMin) {
    throw new Error(`Focus region ${regionId} linearScale rangeMax must be greater than rangeMin.`);
  }
  if (!Number.isInteger(value.divisions) || value.divisions < 1 || value.divisions > 100) {
    throw new Error(`Focus region ${regionId} linearScale divisions must be an integer from 1 to 100.`);
  }
  for (const field of ["scaleStartX", "scaleStartY", "scaleEndX", "scaleEndY", "indicatorHalfWidth"]) {
    assertNormalizedNumber(value[field], `linearScale.${field}`, regionId);
  }
  if (value.indicatorHalfWidth <= 0 || value.indicatorHalfWidth > 0.1) {
    throw new Error(`Focus region ${regionId} linearScale indicatorHalfWidth must be greater than 0 and at most 0.1.`);
  }
  if (value.indicatorMode !== undefined && !["continuous-fill", "perpendicular-stroke"].includes(value.indicatorMode)) {
    throw new Error(`Focus region ${regionId} linearScale indicatorMode must be continuous-fill or perpendicular-stroke.`);
  }
  if (value.indicatorSearchHalfWidth !== undefined) {
    assertNormalizedNumber(value.indicatorSearchHalfWidth, "linearScale.indicatorSearchHalfWidth", regionId);
    if (value.indicatorSearchHalfWidth <= value.indicatorHalfWidth || value.indicatorSearchHalfWidth > 0.25) {
      throw new Error(`Focus region ${regionId} linearScale indicatorSearchHalfWidth must exceed indicatorHalfWidth and be at most 0.25.`);
    }
  }
  for (const field of ["minimumStrokeCoverage", "competitionGap"]) {
    if (value[field] !== undefined && (!Number.isFinite(value[field]) || value[field] <= 0 || value[field] > 1)) {
      throw new Error(`Focus region ${regionId} linearScale ${field} must be greater than 0 and at most 1.`);
    }
  }
  if (Math.hypot(value.scaleEndX - value.scaleStartX, value.scaleEndY - value.scaleStartY) < 0.03) {
    throw new Error(`Focus region ${regionId} linearScale calibration endpoints must be distinct.`);
  }
  if (value.darkThreshold !== undefined
      && (!Number.isInteger(value.darkThreshold) || value.darkThreshold < 0 || value.darkThreshold > 255)) {
    throw new Error(`Focus region ${regionId} linearScale darkThreshold must be an integer from 0 to 255.`);
  }
  return {
    ...value,
    indicatorMode: value.indicatorMode ?? "continuous-fill",
    indicatorSearchHalfWidth: value.indicatorSearchHalfWidth ?? Math.min(0.2, value.indicatorHalfWidth * 2),
    minimumStrokeCoverage: value.minimumStrokeCoverage ?? 0.55,
    competitionGap: value.competitionGap ?? 0.08,
    darkThreshold: value.darkThreshold ?? 90
  };
}

function parseLineSegment(value, regionId, field) {
  assertPlainObject(value, `Focus region ${regionId} opticalRay.${field}`);
  assertKnownFields(value, LINE_SEGMENT_FIELDS, `Focus region ${regionId} opticalRay.${field}`);
  for (const coordinate of LINE_SEGMENT_FIELDS) {
    assertNormalizedNumber(value[coordinate], `opticalRay.${field}.${coordinate}`, regionId);
  }
  if (Math.hypot(value.x2 - value.x1, value.y2 - value.y1) < 0.03) {
    throw new Error(`Focus region ${regionId} opticalRay.${field} endpoints must be distinct.`);
  }
  return { ...value };
}

function parseOpticalRay(value, regionId) {
  if (value === undefined) return null;
  assertPlainObject(value, `Focus region ${regionId} opticalRay`);
  assertKnownFields(value, OPTICAL_RAY_FIELDS, `Focus region ${regionId} opticalRay`);
  assertNormalizedNumber(value.lensY, "opticalRay.lensY", regionId);
  if (value.lineHalfWidth !== undefined
      && (!Number.isFinite(value.lineHalfWidth) || value.lineHalfWidth <= 0 || value.lineHalfWidth > 0.03)) {
    throw new Error(`Focus region ${regionId} opticalRay lineHalfWidth must be greater than 0 and at most 0.03.`);
  }
  if (value.darkThreshold !== undefined
      && (!Number.isInteger(value.darkThreshold) || value.darkThreshold < 0 || value.darkThreshold > 255)) {
    throw new Error(`Focus region ${regionId} opticalRay darkThreshold must be an integer from 0 to 255.`);
  }
  return {
    lensY: value.lensY,
    beforeLeft: parseLineSegment(value.beforeLeft, regionId, "beforeLeft"),
    beforeRight: parseLineSegment(value.beforeRight, regionId, "beforeRight"),
    afterLeft: parseLineSegment(value.afterLeft, regionId, "afterLeft"),
    afterRight: parseLineSegment(value.afterRight, regionId, "afterRight"),
    lineHalfWidth: value.lineHalfWidth ?? 0.004,
    darkThreshold: value.darkThreshold ?? 90
  };
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function parseFocusRegionSpec(value, { sourcePdfSha256 } = {}) {
  assertPlainObject(value, "Focus region specification");
  assertKnownFields(value, ROOT_FIELDS, "Focus region specification");
  if (value.schemaVersion !== "1.0") {
    throw new Error("Focus region specification schemaVersion must be 1.0.");
  }
  if (!/^[a-f0-9]{64}$/u.test(value.sourcePdfSha256 ?? "")) {
    throw new Error("Focus region specification sourcePdfSha256 must be a lowercase SHA-256 digest.");
  }
  if (sourcePdfSha256 && value.sourcePdfSha256 !== sourcePdfSha256.toLowerCase()) {
    throw new Error(
      `Focus region specification source PDF hash mismatch: expected ${value.sourcePdfSha256}, actual ${sourcePdfSha256.toLowerCase()}.`
    );
  }
  if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > MAX_REGIONS) {
    throw new Error(`Focus region specification regions must contain 1-${MAX_REGIONS} entries.`);
  }

  const ids = new Set();
  const regions = value.regions.map((region, index) => {
    assertPlainObject(region, `Focus region ${index + 1}`);
    assertKnownFields(region, REGION_FIELDS, `Focus region ${index + 1}`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(region.id ?? "")) {
      throw new Error(`Focus region ${index + 1} id must be a lowercase kebab-case identifier.`);
    }
    if (ids.has(region.id)) {
      throw new Error(`Focus region id must be unique: ${region.id}.`);
    }
    ids.add(region.id);
    if (typeof region.label !== "string" || region.label.trim().length < 1 || region.label.length > 160) {
      throw new Error(`Focus region ${region.id} label must contain 1-160 characters.`);
    }
    if (!Number.isInteger(region.page) || region.page < 1) {
      throw new Error(`Focus region ${region.id} page must be a positive integer.`);
    }
    if (region.questionNumber !== undefined
        && (!Number.isInteger(region.questionNumber) || region.questionNumber < 1 || region.questionNumber > 99)) {
      throw new Error(`Focus region ${region.id} questionNumber must be an integer from 1 to 99.`);
    }
    for (const field of ["x", "y", "width", "height"]) {
      assertNormalizedNumber(region[field], field, region.id);
    }
    if (region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) {
      throw new Error(`Focus region ${region.id} rectangle must have positive size and stay within the page.`);
    }
    return {
      id: region.id,
      label: region.label.trim(),
      page: region.page,
      questionNumber: region.questionNumber ?? null,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      analogMeter: parseAnalogMeter(region.analogMeter, region.id),
      linearScale: parseLinearScale(region.linearScale, region.id),
      opticalRay: parseOpticalRay(region.opticalRay, region.id)
    };
  });

  return {
    schemaVersion: value.schemaVersion,
    sourcePdfSha256: value.sourcePdfSha256,
    regions
  };
}

export function loadFocusRegionSpec(filePath, sourcePdfPath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedSourcePdfPath = path.resolve(sourcePdfPath);
  const parsed = JSON.parse(fs.readFileSync(resolvedFilePath, "utf8"));
  return {
    ...parseFocusRegionSpec(parsed, { sourcePdfSha256: sha256File(resolvedSourcePdfPath) }),
    filePath: resolvedFilePath,
    fileSha256: sha256File(resolvedFilePath)
  };
}

export function resolveFocusRegionPixels(spec, pageNumber, pageWidth, pageHeight) {
  if (!Number.isInteger(pageWidth) || pageWidth < 1 || !Number.isInteger(pageHeight) || pageHeight < 1) {
    throw new Error("Rendered page dimensions must be positive integers.");
  }
  return spec.regions
    .filter((region) => region.page === pageNumber)
    .map((region, index) => {
      const x = Math.floor(region.x * pageWidth);
      const y = Math.floor(region.y * pageHeight);
      const endX = Math.min(pageWidth, Math.ceil((region.x + region.width) * pageWidth));
      const endY = Math.min(pageHeight, Math.ceil((region.y + region.height) * pageHeight));
      return {
        ...region,
        focusRegionIndex: index + 1,
        x,
        y,
        width: endX - x,
        height: endY - y
      };
    });
}
