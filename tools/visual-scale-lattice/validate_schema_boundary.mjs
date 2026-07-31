import fs from "node:fs";

export function validateVisualScaleLatticeBoundary(declarations, requests, results) {
  if (declarations.length !== 1 || requests.length !== 1 || results.length !== 1) {
    return ["Visual scale lattice requires exactly one canonical declaration, request, and result."];
  }
  const declaration = JSON.parse(fs.readFileSync(declarations[0].filePath, "utf8"));
  const request = JSON.parse(fs.readFileSync(requests[0].filePath, "utf8"));
  const result = JSON.parse(fs.readFileSync(results[0].filePath, "utf8"));
  const errors = [];
  const expectedMajorRefs = [2, 3, 4, 5, 6].map((value) => `scale-component-${String(value).padStart(3, "0")}`);
  if (declaration.majorTickComponentRefs?.join(",") !== expectedMajorRefs.join(",")) {
    errors.push("Scale-lattice major tick component order drifted.");
  }
  const slots = declaration.minorTickSlots ?? [];
  if (slots.length !== 15 || new Set(slots.map((item) => item.regionRef)).size !== 15 || new Set(slots.map((item) => item.slotIndex)).size !== 15) {
    errors.push("Scale-lattice minor slot coverage must remain unique and complete.");
  }
  if (request.egressPolicy?.allowCloud !== false || request.fixtureKind !== "synthetic_fixture") {
    errors.push("Scale-lattice request must remain local synthetic and cloud-disabled.");
  }
  if (result.scaleLattice?.majorSpacingDoubledPixels !== 240 || result.scaleLattice?.subdivisionSpacingDoubledPixels !== 48) {
    errors.push("Scale-lattice canonical geometry drifted.");
  }
  if (result.pointerPosition?.relativeSubdivisionIndex !== 11 || result.pointerPosition?.physicalQuantity !== null || result.pointerPosition?.unit !== null) {
    errors.push("Scale-lattice pointer must remain a relative index without physical quantity or unit.");
  }
  const fixed = {
    scaleInterpretationDisposition: "relative_lattice_only",
    readingDisposition: "relative_index_only",
    physicalReadingDisposition: "not_generated",
    quantityInterpretationDisposition: "not_established",
    unitInterpretationDisposition: "not_established",
    questionBindingDisposition: "not_established",
    trackDisposition: "not_integrated",
    answerDisposition: "not_generated",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false
  };
  for (const [key, value] of Object.entries(fixed)) {
    if (result.dispositions?.[key] !== value) errors.push(`Scale-lattice boundary must keep ${key}=${String(value)}.`);
  }
  if (!Array.isArray(result.dispositions?.optimizationCandidateRefs) || result.dispositions.optimizationCandidateRefs.length !== 0) {
    errors.push("Scale-lattice result must not emit optimization candidates.");
  }
  return errors;
}
