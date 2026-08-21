export function analyzeOpticalRayCanvas(config) {
  const measureLineEvidence = (imageData, targetCanvas, segment, searchHalfWidth, threshold) => {
    const x1 = segment.x1 * targetCanvas.width;
    const y1 = segment.y1 * targetCanvas.height;
    const x2 = segment.x2 * targetCanvas.width;
    const y2 = segment.y2 * targetCanvas.height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const nx = -dy / length;
    const ny = dx / length;
    const steps = Math.max(20, Math.round(length));
    let hit = 0;
    let competingHit = 0;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      let dark = false;
      for (let offset = -searchHalfWidth; offset <= searchHalfWidth; offset += 1) {
        const x = Math.round(x1 + dx * t + nx * offset);
        const y = Math.round(y1 + dy * t + ny * offset);
        if (x < 0 || x >= targetCanvas.width || y < 0 || y >= targetCanvas.height) continue;
        const index = (y * targetCanvas.width + x) * 4;
        const luminance = 0.2126 * imageData.data[index]
          + 0.7152 * imageData.data[index + 1]
          + 0.0722 * imageData.data[index + 2];
        if (imageData.data[index + 3] > 0 && luminance <= threshold) {
          dark = true;
          break;
        }
      }
      hit += dark ? 1 : 0;
      let competingDark = false;
      for (const side of [-1, 1]) {
        for (let offset = searchHalfWidth * 2; offset <= searchHalfWidth * 4; offset += 1) {
          const x = Math.round(x1 + dx * t + nx * offset * side);
          const y = Math.round(y1 + dy * t + ny * offset * side);
          if (x < 0 || x >= targetCanvas.width || y < 0 || y >= targetCanvas.height) continue;
          const index = (y * targetCanvas.width + x) * 4;
          const luminance = 0.2126 * imageData.data[index]
            + 0.7152 * imageData.data[index + 1]
            + 0.0722 * imageData.data[index + 2];
          if (imageData.data[index + 3] > 0 && luminance <= threshold) {
            competingDark = true;
            break;
          }
        }
        if (competingDark) break;
      }
      competingHit += competingDark ? 1 : 0;
    }
    return { coverage: hit / (steps + 1), competingCoverage: competingHit / (steps + 1) };
  };
  const findIntersectionY = (left, right) => {
    const leftSlope = (left.x2 - left.x1) / (left.y2 - left.y1);
    const rightSlope = (right.x2 - right.x1) / (right.y2 - right.y1);
    const denominator = leftSlope - rightSlope;
    if (Math.abs(denominator) < 1e-6) return null;
    const leftIntercept = left.x1 - leftSlope * left.y1;
    const rightIntercept = right.x1 - rightSlope * right.y1;
    return (rightIntercept - leftIntercept) / denominator;
  };
  const canvas = globalThis.window?.pdfReview?.focusCanvases?.[config.regionId];
  if (!canvas) throw new Error(`Focused crop canvas not found for optical ray geometry: ${config.regionId}.`);
  const image = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
  const halfWidth = Math.max(2, Math.round(config.lineHalfWidth * Math.min(canvas.width, canvas.height)));
  const names = ["beforeLeft", "beforeRight", "afterLeft", "afterRight"];
  const evidence = Object.fromEntries(names.map((name) => [
    name, measureLineEvidence(image, canvas, config[name], halfWidth, config.darkThreshold ?? 90)
  ]));
  const coverages = Object.fromEntries(names.map((name) => [name, Number(evidence[name].coverage.toFixed(4))]));
  const competingCoverages = Object.fromEntries(names.map((name) => [
    name, Number(evidence[name].competingCoverage.toFixed(4))
  ]));
  const minimumCoverage = Math.min(...Object.values(coverages));
  const maximumCompetingCoverage = Math.max(...Object.values(competingCoverages));
  const beforeIntersectionY = findIntersectionY(config.beforeLeft, config.beforeRight);
  const afterIntersectionY = findIntersectionY(config.afterLeft, config.afterRight);
  const validIntersections = beforeIntersectionY !== null && afterIntersectionY !== null
    && beforeIntersectionY > config.lensY && afterIntersectionY > config.lensY;
  if (minimumCoverage < 0.7 || maximumCompetingCoverage >= 0.7 || !validIntersections) {
    return {
      schemaVersion: "1.0", kind: "optical-ray-geometry", status: "uncertain",
      regionId: config.regionId, relation: null, lineCoverages: coverages,
      competingLineCoverages: competingCoverages,
      beforeIntersectionY: null, afterIntersectionY: null
    };
  }
  const delta = afterIntersectionY - beforeIntersectionY;
  const tolerance = 0.02;
  const relation = delta > tolerance ? "converging_less" : delta < -tolerance ? "converging_more" : "unchanged";
  return {
    schemaVersion: "1.0", kind: "optical-ray-geometry", status: "measured",
    regionId: config.regionId, relation, lineCoverages: coverages,
    competingLineCoverages: competingCoverages,
    beforeIntersectionY: Number(beforeIntersectionY.toFixed(4)),
    afterIntersectionY: Number(afterIntersectionY.toFixed(4)),
    intersectionDelta: Number(delta.toFixed(4))
  };
}
