export function analyzeLinearScaleCanvas(config) {
  const makeUncertain = (details = {}) => ({
    schemaVersion: "1.0",
    kind: "linear-scale-geometry-reading",
    status: "uncertain",
    regionId: config.regionId,
    rangeMin: config.rangeMin,
    rangeMax: config.rangeMax,
    divisions: config.divisions,
    rawDivision: null,
    nearestDivision: null,
    divisionResidual: null,
    value: null,
    ...details
  });
  const canvas = globalThis.window?.pdfReview?.focusCanvases?.[config.regionId];
  if (!canvas) throw new Error(`Focused crop canvas not found for linear scale: ${config.regionId}.`);
  const image = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
  const base = Math.min(canvas.width, canvas.height);
  const start = { x: config.scaleStartX * canvas.width, y: config.scaleStartY * canvas.height };
  const end = { x: config.scaleEndX * canvas.width, y: config.scaleEndY * canvas.height };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const perpendicular = { x: -dy / length, y: dx / length };
  const halfWidth = Math.max(3, Math.round(config.indicatorHalfWidth * base));
  const isDark = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return false;
    const offset = (py * canvas.width + px) * 4;
    const luminance = 0.2126 * image.data[offset]
      + 0.7152 * image.data[offset + 1]
      + 0.0722 * image.data[offset + 2];
    return image.data[offset + 3] > 0 && luminance <= (config.darkThreshold ?? 90);
  };
  const sampleCount = Math.max(80, Math.round(length));
  if (config.indicatorMode === "perpendicular-stroke") {
    const searchHalfWidth = Math.max(halfWidth + 1, Math.round((config.indicatorSearchHalfWidth ?? 0.2) * base));
    const scores = [];
    for (let index = 0; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const centerX = start.x + dx * t;
      const centerY = start.y + dy * t;
      let dark = 0;
      let samples = 0;
      for (let offset = -searchHalfWidth; offset <= searchHalfWidth; offset += 1) {
        const x = centerX + perpendicular.x * offset;
        const y = centerY + perpendicular.y * offset;
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) continue;
        const imageOffset = (py * canvas.width + px) * 4;
        const luminance = 0.2126 * image.data[imageOffset]
          + 0.7152 * image.data[imageOffset + 1]
          + 0.0722 * image.data[imageOffset + 2];
        dark += image.data[imageOffset + 3] > 0 && luminance <= (config.darkThreshold ?? 90) ? 1 : 0;
        samples += 1;
      }
      scores.push({ t, coverage: samples > 0 ? dark / samples : 0 });
    }
    const sorted = [...scores].sort((left, right) => right.coverage - left.coverage);
    const best = sorted[0];
    const runnerUp = sorted.find((candidate) => Math.abs(candidate.t - best.t) > 0.04) ?? { coverage: 0 };
    const rawDivision = best.t * config.divisions;
    const nearestDivision = Math.round(rawDivision);
    const divisionResidual = Math.abs(rawDivision - nearestDivision);
    const status = best.coverage >= (config.minimumStrokeCoverage ?? 0.55)
      && best.coverage - runnerUp.coverage >= (config.competitionGap ?? 0.08)
      && divisionResidual <= 0.35
      ? "measured"
      : "uncertain";
    return {
      schemaVersion: "1.0",
      kind: "linear-scale-geometry-reading",
      status,
      regionId: config.regionId,
      rangeMin: config.rangeMin,
      rangeMax: config.rangeMax,
      divisions: config.divisions,
      rawDivision: status === "measured" ? Number(rawDivision.toFixed(3)) : null,
      nearestDivision: status === "measured" ? nearestDivision : null,
      divisionResidual: status === "measured" ? Number(divisionResidual.toFixed(3)) : null,
      maximumDarkFraction: Number(best.coverage.toFixed(4)),
      runnerUpDarkFraction: Number(runnerUp.coverage.toFixed(4)),
      value: status === "measured"
        ? Number((config.rangeMin + (config.rangeMax - config.rangeMin) * nearestDivision / config.divisions).toPrecision(12))
        : null
    };
  }
  const rows = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const centerX = start.x + dx * t;
    const centerY = start.y + dy * t;
    let dark = 0;
    for (let offset = -halfWidth; offset <= halfWidth; offset += 1) {
      dark += isDark(centerX + perpendicular.x * offset, centerY + perpendicular.y * offset) ? 1 : 0;
    }
    rows.push(dark / (halfWidth * 2 + 1));
  }
  const filled = rows.map((fraction) => fraction >= 0.52);
  const startWindow = Math.max(5, Math.round(sampleCount * 0.06));
  if (filled.slice(0, startWindow).filter(Boolean).length / startWindow < 0.7) {
    return makeUncertain({ maximumDarkFraction: Number(Math.max(...rows).toFixed(4)) });
  }
  let lastFilled = 0;
  let gap = 0;
  const toleratedGap = Math.max(2, Math.round(sampleCount * 0.015));
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index]) {
      lastFilled = index;
      gap = 0;
    } else {
      gap += 1;
      if (gap > toleratedGap) break;
    }
  }
  const rawDivision = lastFilled / sampleCount * config.divisions;
  const nearestDivision = Math.round(rawDivision);
  const divisionResidual = Math.abs(rawDivision - nearestDivision);
  const tail = filled.slice(Math.min(filled.length, lastFilled + toleratedGap + 1));
  let longestTailRun = 0;
  let currentTailRun = 0;
  for (const isFilled of tail) {
    currentTailRun = isFilled ? currentTailRun + 1 : 0;
    longestTailRun = Math.max(longestTailRun, currentTailRun);
  }
  const longestTailRunFraction = longestTailRun / sampleCount;
  if (lastFilled < startWindow || lastFilled >= sampleCount - startWindow
      || divisionResidual > 0.35 || longestTailRunFraction > 0.08) {
    return makeUncertain({
      maximumDarkFraction: Number(Math.max(...rows).toFixed(4)),
      longestTailRunFraction: Number(longestTailRunFraction.toFixed(4))
    });
  }
  const value = config.rangeMin
    + (config.rangeMax - config.rangeMin) * nearestDivision / config.divisions;
  return {
    schemaVersion: "1.0",
    kind: "linear-scale-geometry-reading",
    status: "measured",
    regionId: config.regionId,
    rangeMin: config.rangeMin,
    rangeMax: config.rangeMax,
    divisions: config.divisions,
    rawDivision: Number(rawDivision.toFixed(3)),
    nearestDivision,
    divisionResidual: Number(divisionResidual.toFixed(3)),
    maximumDarkFraction: Number(Math.max(...rows).toFixed(4)),
    longestTailRunFraction: Number(longestTailRunFraction.toFixed(4)),
    value: Number(value.toPrecision(12))
  };
}
