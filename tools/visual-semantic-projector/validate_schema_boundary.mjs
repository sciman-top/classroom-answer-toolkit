import { readJsonFile } from "../rule-compiler/shared.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

function rejectMutations(target, mutations, label) {
  const errors = [];
  if (!target) {
    return [`Visual semantic projection boundary requires a canonical ${label} fixture.`];
  }
  const canonical = readJsonFile(target.filePath);
  for (const [mutationLabel, mutate] of mutations) {
    const candidate = structuredClone(canonical);
    mutate(candidate);
    if (validateValueAgainstSchema(candidate, target.schemaPath).length === 0) {
      errors.push(`Visual semantic projection ${label} schema must reject ${mutationLabel}.`);
    }
  }
  return errors;
}

export function validateVisualSemanticProjectionBoundary(
  declarations,
  requests,
  results,
  inventories,
  reports) {
  return [
    ...rejectMutations(declarations[0], [
      ["inferred role", (value) => { value.semanticRole = "diagram_label"; }],
      ["live provider", (value) => { value.authorityProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.authorityProvenance.cloudEgress = true; }],
      ["answer field", (value) => { value.answer = "12"; }]
    ], "declaration"),
    ...rejectMutations(requests[0], [
      ["implicit role source", (value) => { value.projectionPolicy.roleSource = "inferred"; }],
      ["truth text source", (value) => { value.projectionPolicy.textSource = "truth_text"; }],
      ["non-exact cardinality", (value) => { value.projectionPolicy.cardinality = "at_least_one"; }],
      ["cloud egress", (value) => { value.egressPolicy.allowCloud = true; }]
    ], "request"),
    ...rejectMutations(results[0], [
      ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
      ["layout inference", (value) => { value.dispositions.layoutDisposition = "inferred"; }],
      ["figure understanding", (value) => { value.dispositions.figureUnderstandingDisposition = "generated"; }],
      ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
      ["delivery trust", (value) => { value.dispositions.deliveryTrustDisposition = "trusted"; }],
      ["WPF integration", (value) => { value.dispositions.wpfDisposition = "integrated"; }],
      ["live acceptance", (value) => { value.dispositions.liveAcceptanceDisposition = "accepted"; }],
      ["verified controls", (value) => { value.dispositions.controlsDisposition = "verified"; }],
      ["eligibility", (value) => { value.dispositions.eligible = true; }],
      ["optimization candidate", (value) => { value.dispositions.optimizationCandidateRefs = ["forbidden"]; }],
      ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
    ], "result"),
    ...rejectMutations(inventories[0], [
      ["zero admitted cases", (value) => { value.entries = []; }],
      ["second admitted case", (value) => { value.entries.push(structuredClone(value.entries[0])); }]
    ], "inventory"),
    ...rejectMutations(reports[0], [
      ["positive acceptance", (value) => { value.dispositions.acceptanceDisposition = "accepted"; }],
      ["figure understanding", (value) => { value.dispositions.figureUnderstandingDisposition = "generated"; }],
      ["Track integration", (value) => { value.dispositions.trackDisposition = "integrated"; }],
      ["delivery trust", (value) => { value.dispositions.deliveryTrustDisposition = "trusted"; }],
      ["WPF integration", (value) => { value.dispositions.wpfDisposition = "integrated"; }],
      ["live acceptance", (value) => { value.dispositions.liveAcceptanceDisposition = "accepted"; }],
      ["verified controls", (value) => { value.dispositions.controlsDisposition = "verified"; }],
      ["eligibility", (value) => { value.dispositions.eligible = true; }],
      ["optimization candidate", (value) => { value.dispositions.optimizationCandidateRefs = ["forbidden"]; }],
      ["live provider", (value) => { value.engineProvenance.liveProvider = true; }],
      ["cloud egress", (value) => { value.engineProvenance.cloudEgress = true; }]
    ], "report")
  ];
}
