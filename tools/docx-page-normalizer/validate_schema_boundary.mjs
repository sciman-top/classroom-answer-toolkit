import fs from "node:fs";

export function validateDocxPageNormalizationBoundary(requests, results) {
  if (requests.length !== 1 || results.length !== 1) {
    return ["DOCX page normalization requires exactly one canonical request and result."];
  }
  const request = JSON.parse(fs.readFileSync(requests[0].filePath, "utf8"));
  const result = JSON.parse(fs.readFileSync(results[0].filePath, "utf8"));
  const errors = [];
  if (request.adapterProfile !== "image_backed_single_page_only" || request.egressPolicy?.allowCloud !== false) {
    errors.push("DOCX normalization request must remain image-backed, local, and cloud-disabled.");
  }
  const page = result.pages?.[0]?.normalizedPage;
  if (result.pages?.length !== 1 || page?.sourceKind !== "docx" || page?.imagePath !== "page-001.png") {
    errors.push("DOCX normalization must emit exactly one DOCX-backed normalized page.");
  }
  for (const key of ["regionRefs", "ocrRefs", "layoutRefs", "qualityFlags"]) {
    if (!Array.isArray(page?.[key]) || page[key].length !== 0) {
      errors.push(`DOCX normalized page must keep ${key} empty.`);
    }
  }
  const fixed = {
    adapterDisposition: "image_backed_single_page_only",
    layoutDisposition: "not_reconstructed",
    bodyTextDisposition: "not_extracted",
    tableDisposition: "not_supported",
    ommlDisposition: "not_supported",
    paginationDisposition: "single_page_declared_shape_only",
    regionDisposition: "not_generated",
    ocrDisposition: "not_attempted",
    trackDisposition: "not_integrated",
    answerDisposition: "not_generated",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false
  };
  for (const [key, value] of Object.entries(fixed)) {
    if (result.dispositions?.[key] !== value) errors.push(`DOCX normalization boundary must keep ${key}=${String(value)}.`);
  }
  if (!Array.isArray(result.dispositions?.optimizationCandidateRefs) || result.dispositions.optimizationCandidateRefs.length !== 0) {
    errors.push("DOCX normalization must not emit optimization candidates.");
  }
  return errors;
}
