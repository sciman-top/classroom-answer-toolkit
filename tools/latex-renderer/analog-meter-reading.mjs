export function analyzeAnalogMeterCanvas(config) {
  const canvas = globalThis.window?.pdfReview?.focusCanvases?.[config.regionId];
  if (!canvas) {
    throw new Error(`Focused crop canvas not found for analog meter: ${config.regionId}.`);
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const radialBase = Math.min(canvas.width, canvas.height);
  const pivotX = config.pivotX * canvas.width;
  const pivotY = config.pivotY * canvas.height;
  const radiusMin = Math.max(1, Math.round(config.pointerRadiusMin * radialBase));
  const radiusMax = Math.max(radiusMin + 1, Math.round(config.pointerRadiusMax * radialBase));
  const angleStep = 0.05;
  const lineHalfWidth = Math.max(1, Math.round(radialBase / 700));
  const scores = [];
  const isDarkPixel = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) {
      return false;
    }
    const offset = (py * canvas.width + px) * 4;
    const luminance = 0.2126 * image.data[offset]
      + 0.7152 * image.data[offset + 1]
      + 0.0722 * image.data[offset + 2];
    return image.data[offset + 3] > 0 && luminance <= (config.darkThreshold ?? 110);
  };

  for (let angle = config.scaleStartAngleDegrees;
       angle <= config.scaleEndAngleDegrees + angleStep / 2;
       angle += angleStep) {
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    let darkSamples = 0;
    let samples = 0;
    for (let radius = radiusMin; radius <= radiusMax; radius += 1) {
      let dark = false;
      for (let offset = -lineHalfWidth; offset <= lineHalfWidth; offset += 1) {
        const x = pivotX + radius * cos - offset * sin;
        const y = pivotY + radius * sin + offset * cos;
        if (isDarkPixel(x, y)) {
          dark = true;
          break;
        }
      }
      darkSamples += dark ? 1 : 0;
      samples += 1;
    }
    scores.push({ angle, coverage: samples > 0 ? darkSamples / samples : 0 });
  }

  const maximumCoverage = Math.max(...scores.map((candidate) => candidate.coverage));
  const peakThreshold = Math.max(0.55, maximumCoverage - 0.02);
  const peakGroups = [];
  for (const candidate of scores) {
    if (candidate.coverage < peakThreshold) {
      continue;
    }
    const current = peakGroups.at(-1);
    if (!current || candidate.angle - current.at(-1).angle > angleStep * 1.5) {
      peakGroups.push([candidate]);
    } else {
      current.push(candidate);
    }
  }
  if (peakGroups.length === 0) {
    return {
      schemaVersion: "1.0",
      kind: "analog-meter-geometry-reading",
      status: "uncertain",
      regionId: config.regionId,
      rangeMin: config.rangeMin,
      rangeMax: config.rangeMax,
      divisions: config.divisions,
      pointerAngleDegrees: null,
      pointerLineCoverage: Number(maximumCoverage.toFixed(4)),
      competingLineCoverage: null,
      rawDivision: null,
      nearestDivision: null,
      divisionResidual: null,
      value: null
    };
  }
  const bestGroup = peakGroups.reduce((winner, candidate) => {
    const candidateWeight = candidate.reduce((sum, item) => sum + item.coverage, 0);
    const winnerWeight = winner.reduce((sum, item) => sum + item.coverage, 0);
    return candidateWeight > winnerWeight ? candidate : winner;
  });
  const bestWeight = bestGroup.reduce((sum, candidate) => sum + candidate.coverage, 0);
  const best = {
    angle: bestGroup.reduce((sum, candidate) => sum + candidate.angle * candidate.coverage, 0) / bestWeight,
    coverage: maximumCoverage
  };
  const runnerUp = scores
    .filter((candidate) => Math.abs(candidate.angle - best.angle) >= 2.5)
    .reduce((winner, candidate) => (
      candidate.coverage > winner.coverage ? candidate : winner
    ), { angle: null, coverage: 0 });
  const rawDivision = (best.angle - config.scaleStartAngleDegrees)
    / (config.scaleEndAngleDegrees - config.scaleStartAngleDegrees)
    * config.divisions;
  const nearestDivision = Math.max(0, Math.min(config.divisions, Math.round(rawDivision)));
  const divisionResidual = Math.abs(rawDivision - nearestDivision);
  const value = config.rangeMin
    + (config.rangeMax - config.rangeMin) * nearestDivision / config.divisions;
  const status = best.coverage >= 0.55 && divisionResidual <= 0.35
    ? "measured"
    : "uncertain";

  return {
    schemaVersion: "1.0",
    kind: "analog-meter-geometry-reading",
    status,
    regionId: config.regionId,
    rangeMin: config.rangeMin,
    rangeMax: config.rangeMax,
    divisions: config.divisions,
    pointerAngleDegrees: Number(best.angle.toFixed(2)),
    pointerLineCoverage: Number(best.coverage.toFixed(4)),
    competingLineCoverage: Number(runnerUp.coverage.toFixed(4)),
    rawDivision: Number(rawDivision.toFixed(3)),
    nearestDivision,
    divisionResidual: Number(divisionResidual.toFixed(3)),
    value: status === "measured" ? Number(value.toPrecision(12)) : null
  };
}
