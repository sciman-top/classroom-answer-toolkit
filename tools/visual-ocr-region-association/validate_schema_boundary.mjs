import { readJsonFile } from "../rule-compiler/shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

export function validateVisualOcrRegionAssociationBoundary(resultTargets, reportTargets) {
  const errors = [];
  const canonicalResultTarget = resultTargets[0];
  const canonicalReportTarget = reportTargets[0];
  if (!canonicalResultTarget) {
    errors.push("Visual OCR-region association boundary requires a canonical result fixture.");
  } else {
    const canonical = readJsonFile(canonicalResultTarget.filePath);
    const mutations = [
      ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
      ["human review bypass", (value) => { value.dispositions.requiresHumanReview = false; }],
      ["OCR correctness inference", (value) => { value.dispositions.ocrCorrectnessDisposition = "accepted"; }],
      ["layout inference", (value) => { value.dispositions.layoutDisposition = "inferred"; }],
      ["semantic inference", (value) => { value.dispositions.semanticDisposition = "inferred"; }],
      ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
      ["ambiguous endpoint count", (value) => { value.summary.ambiguousEndpointCount = 1; }],
      ["unavailable ratio value", (value) => { value.summary.associationRate.available = false; }],
      ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
    ];
    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(canonical);
      mutate(candidate);
      if (validateValueAgainstSchema(candidate, canonicalResultTarget.schemaPath).length === 0) {
        errors.push(`Visual OCR-region association result schema must reject ${label}.`);
      }
    }
  }
  if (!canonicalReportTarget) {
    errors.push("Visual OCR-region association boundary requires a canonical report fixture.");
  } else {
    const canonical = readJsonFile(canonicalReportTarget.filePath);
    const mutations = [
      ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
      ["delivery trust projection", (value) => { value.dispositions.deliveryTrustDisposition = "trusted"; }],
      ["WPF integration", (value) => { value.dispositions.wpfDisposition = "integrated"; }],
      ["live acceptance", (value) => { value.dispositions.liveAcceptanceDisposition = "accepted"; }],
      ["verified controls", (value) => { value.dispositions.controlsDisposition = "verified"; }],
      ["eligibility", (value) => { value.dispositions.eligible = true; }],
      ["optimization candidate", (value) => { value.dispositions.optimizationCandidateRefs = ["forbidden"]; }],
      ["ambiguous case count", (value) => { value.totals.ambiguousCaseCount = 1; }],
      ["unavailable ratio value", (value) => { value.subjectReports[0].metrics.associationRate.value = 0; }],
      ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
    ];
    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(canonical);
      mutate(candidate);
      if (validateValueAgainstSchema(candidate, canonicalReportTarget.schemaPath).length === 0) {
        errors.push(`Visual OCR-region association report schema must reject ${label}.`);
      }
    }
  }
  return errors;
}
