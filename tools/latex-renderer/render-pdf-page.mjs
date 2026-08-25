// In-page rendering protocol executed inside the browser context via
// page.evaluate. This function must stay self-contained: it may only reference
// its destructured parameters and browser globals (window/document), because
// Playwright serializes the function reference itself.
export async function loadPdfDocumentInBrowser({ data }) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const loadingTask = window.pdfReview.pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  window.pdfReview.document = pdf;
  return {
    pageCount: pdf.numPages,
    fingerprint: pdf.fingerprints?.[0] ?? null
  };
}

export async function getPageDimensionsInBrowser({ pageNumber, scale, focusScale }) {
  const pdfPage = await window.pdfReview.document.getPage(pageNumber);
  const viewport = pdfPage.getViewport({ scale });
  const focusViewport = pdfPage.getViewport({ scale: focusScale });
  return {
    width: Math.ceil(viewport.width),
    height: Math.ceil(viewport.height),
    focusWidth: Math.ceil(focusViewport.width),
    focusHeight: Math.ceil(focusViewport.height)
  };
}

export async function renderPdfPageInBrowser({
  pageNumber: pageNo,
  scale,
  verticalTiles,
  horizontalTiles,
  questionRegions,
  tileOverlap,
  focusRenderScale,
  focusRegions,
  previousQuestionNumber
}) {
  const pdfPage = await window.pdfReview.document.getPage(pageNo);
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: context, viewport }).promise;

  const textContent = await pdfPage.getTextContent().catch(() => ({ items: [] }));
  const text = textContent.items.map((item) => item.str).join("").trim();

  const markerCandidates = textContent.items
    .map((item) => {
      const match = String(item.str ?? "").trim().match(/^(\d{1,2})\.$/u);
      if (!match || Number(item.transform?.[4]) > 90) {
        return null;
      }
      const viewportPoint = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      return { number: Number(match[1]), y: viewportPoint[1] };
    })
    .filter(Boolean)
    .sort((left, right) => left.y - right.y);
  const questionMarkers = [];
  let detectedQuestionNumber = previousQuestionNumber;
  for (const candidate of markerCandidates) {
    const continuesPrevious = questionMarkers.length === 0
      && candidate.number === detectedQuestionNumber;
    if (continuesPrevious || candidate.number === detectedQuestionNumber + 1) {
      questionMarkers.push(candidate);
      detectedQuestionNumber = Math.max(detectedQuestionNumber, candidate.number);
    }
  }

  const regions = [];
  if (questionRegions) {
    const margin = Math.max(24, Math.round(16 * scale));
    if (questionMarkers.length === 0) {
      regions.push({ questionNumber: detectedQuestionNumber || null, y: 0, endY: canvas.height });
    } else {
      const firstStart = Math.max(0, Math.floor(questionMarkers[0].y - margin));
      if (firstStart > margin && previousQuestionNumber > 0
          && questionMarkers[0].number > previousQuestionNumber) {
        regions.push({ questionNumber: previousQuestionNumber, y: 0, endY: firstStart });
      }
      for (let index = 0; index < questionMarkers.length; index += 1) {
        const marker = questionMarkers[index];
        const y = Math.max(0, Math.floor(marker.y - margin));
        const endY = index + 1 < questionMarkers.length
          ? Math.max(y + 1, Math.floor(questionMarkers[index + 1].y - margin))
          : canvas.height;
        regions.push({ questionNumber: marker.number, y, endY });
      }
    }
  } else {
    const baseTileHeight = canvas.height / verticalTiles;
    const overlapPixels = baseTileHeight * tileOverlap;
    for (let tileIndex = 0; tileIndex < verticalTiles; tileIndex += 1) {
      const y = Math.max(0, Math.floor(tileIndex * baseTileHeight - overlapPixels));
      const endY = Math.min(canvas.height, Math.ceil((tileIndex + 1) * baseTileHeight + overlapPixels));
      regions.push({ questionNumber: null, y, endY });
    }
  }

  const tiles = [];
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex];
    const baseTileWidth = canvas.width / horizontalTiles;
    const horizontalOverlapPixels = baseTileWidth * tileOverlap;
    for (let horizontalIndex = 0; horizontalIndex < horizontalTiles; horizontalIndex += 1) {
      const x = Math.max(0, Math.floor(horizontalIndex * baseTileWidth - horizontalOverlapPixels));
      const endX = Math.min(canvas.width, Math.ceil((horizontalIndex + 1) * baseTileWidth + horizontalOverlapPixels));
      const y = region.y;
      const endY = region.endY;
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = endX - x;
      tileCanvas.height = endY - y;
      const tileContext = tileCanvas.getContext("2d", { alpha: false });
      tileContext.fillStyle = "white";
      tileContext.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
      tileContext.drawImage(
        canvas,
        x,
        y,
        tileCanvas.width,
        tileCanvas.height,
        0,
        0,
        tileCanvas.width,
        tileCanvas.height
      );
      tiles.push({
        kind: "page-tile",
        dataUrl: tileCanvas.toDataURL("image/png"),
        tileIndex: regionIndex + 1,
        tileCount: regions.length,
        horizontalIndex: horizontalIndex + 1,
        horizontalTileCount: horizontalTiles,
        questionNumber: region.questionNumber,
        x,
        y,
        width: tileCanvas.width,
        height: tileCanvas.height,
        sourcePageWidth: canvas.width,
        sourcePageHeight: canvas.height,
        focusRegionIndex: null,
        focusRegionId: null,
        focusLabel: null
      });
    }
  }

  let focusSourceCanvas = canvas;
  if (focusRegions.length > 0 && focusRenderScale !== scale) {
    const focusViewport = pdfPage.getViewport({ scale: focusRenderScale });
    focusSourceCanvas = document.createElement("canvas");
    focusSourceCanvas.width = Math.ceil(focusViewport.width);
    focusSourceCanvas.height = Math.ceil(focusViewport.height);
    const focusSourceContext = focusSourceCanvas.getContext("2d", { alpha: false });
    focusSourceContext.fillStyle = "white";
    focusSourceContext.fillRect(0, 0, focusSourceCanvas.width, focusSourceCanvas.height);
    await pdfPage.render({ canvasContext: focusSourceContext, viewport: focusViewport }).promise;
  }

  window.pdfReview.focusCanvases = window.pdfReview.focusCanvases ?? {};
  for (const focusRegion of focusRegions) {
    const focusCanvas = document.createElement("canvas");
    focusCanvas.width = focusRegion.width;
    focusCanvas.height = focusRegion.height;
    const focusContext = focusCanvas.getContext("2d", { alpha: false });
    focusContext.fillStyle = "white";
    focusContext.fillRect(0, 0, focusCanvas.width, focusCanvas.height);
    focusContext.drawImage(
      focusSourceCanvas,
      focusRegion.x,
      focusRegion.y,
      focusRegion.width,
      focusRegion.height,
      0,
      0,
      focusRegion.width,
      focusRegion.height
    );
    window.pdfReview.focusCanvases[focusRegion.id] = focusCanvas;
    tiles.push({
      kind: "focus-region",
      dataUrl: focusCanvas.toDataURL("image/png"),
      tileIndex: null,
      tileCount: null,
      horizontalIndex: null,
      horizontalTileCount: null,
      questionNumber: focusRegion.questionNumber,
      x: focusRegion.x,
      y: focusRegion.y,
      width: focusRegion.width,
      height: focusRegion.height,
      sourcePageWidth: focusSourceCanvas.width,
      sourcePageHeight: focusSourceCanvas.height,
      focusRegionIndex: focusRegion.focusRegionIndex,
      focusRegionId: focusRegion.id,
      focusLabel: focusRegion.label
    });
  }

  return {
    width: canvas.width,
    height: canvas.height,
    text,
    tiles,
    detectedQuestionNumber
  };
}
