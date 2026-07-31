import fs from "node:fs";

export function validateVisualComponentSemanticsBoundary(declarations, requests, results) {
  if (declarations.length !== 1 || requests.length !== 1 || results.length !== 1) {
    return ["Visual component semantics requires exactly one canonical declaration, request, and result."];
  }
  const declaration = JSON.parse(fs.readFileSync(declarations[0].filePath, "utf8"));
  const request = JSON.parse(fs.readFileSync(requests[0].filePath, "utf8"));
  const result = JSON.parse(fs.readFileSync(results[0].filePath, "utf8"));
  const errors = [];
  const types = result.components?.map((item) => item.componentType) ?? [];
  if (types.join(",") !== ["pointer_indicator", ...Array(5).fill("major_tick_mark")].join(",")) errors.push("Component semantics canonical type inventory drifted.");
  const refs = declaration.componentDeclarations?.flatMap((item) => item.candidateRefs) ?? [];
  if (refs.length !== 12 || new Set(refs).size !== 12) errors.push("Component semantics candidate coverage must be unique and complete.");
  if (request.egressPolicy?.allowCloud !== false) errors.push("Component semantics cloud egress must remain disabled.");
  const fixed = { inferenceDisposition: "not_performed", figureUnderstandingDisposition: "not_generated", scaleInterpretationDisposition: "not_established", readingDisposition: "not_generated", questionBindingDisposition: "not_established", trackDisposition: "not_integrated", answerDisposition: "not_generated", requiresHumanReview: true, acceptanceDisposition: "not_accepted", controlsDisposition: "not_verified", eligible: false };
  for (const [key, value] of Object.entries(fixed)) if (result.dispositions?.[key] !== value) errors.push(`Component semantics boundary must keep ${key}=${String(value)}.`);
  return errors;
}
