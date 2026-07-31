import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function validateVisualRegionSemanticsBoundary(
  declarationFiles,
  requestFiles,
  resultFiles
) {
  const errors = [];
  if (declarationFiles.length !== 1 || requestFiles.length !== 1 || resultFiles.length !== 1) {
    return ["Visual region semantics canonical fixture coverage must be exactly one declaration, request, and result."];
  }
  const declaration = readJson(declarationFiles[0].filePath);
  const request = readJson(requestFiles[0].filePath);
  const result = readJson(resultFiles[0].filePath);
  const declarations = declaration.regionDeclarations ?? [];
  const regions = result.regionSemantics ?? [];
  const expectedRefs = ["content-block-001", "content-block-002"];
  if (declarations.map((item) => item.proposalRef).join(",") !== expectedRefs.join(",")) {
    errors.push("Visual region semantics declaration proposal coverage must be ordered and complete.");
  }
  if (regions.map((item) => item.proposalRef).join(",") !== expectedRefs.join(",")) {
    errors.push("Visual region semantics result proposal coverage must be ordered and complete.");
  }
  if (declarations.some((item) => item.proposalKind !== "content_block_candidate")) {
    errors.push("Visual region semantics declarations must remain proposal-bound candidates.");
  }
  if (regions.some((item) => item.classificationBasis !== "explicit_synthetic_region_semantics_declaration")) {
    errors.push("Visual region semantics must record explicit declaration basis.");
  }
  const dispositions = result.dispositions ?? {};
  const fixed = {
    semanticDisposition: "explicit_declared",
    visualRegionDisposition: "generated_from_explicit_synthetic_declaration",
    inferenceDisposition: "not_performed",
    questionBindingDisposition: "not_established",
    trackDisposition: "not_integrated",
    answerDisposition: "not_generated",
    requiresHumanReview: true,
    acceptanceDisposition: "not_accepted",
    controlsDisposition: "not_verified",
    eligible: false
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (dispositions[key] !== expected) {
      errors.push(`Visual region semantics result boundary must keep ${key}=${String(expected)}.`);
    }
  }
  if (!Array.isArray(dispositions.optimizationCandidateRefs) || dispositions.optimizationCandidateRefs.length !== 0) {
    errors.push("Visual region semantics must not emit optimization candidates.");
  }
  if (request.egressPolicy?.allowCloud !== false || request.fixtureKind !== "synthetic_fixture") {
    errors.push("Visual region semantics request must remain local synthetic and cloud-disabled.");
  }
  return errors;
}
