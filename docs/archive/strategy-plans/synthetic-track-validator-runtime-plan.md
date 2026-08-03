# Synthetic Track Validator Runtime Plan

## Scope

`VISION-018` adds the first deterministic Track C validator for the public synthetic
`junior-readable-measurement` case. It consumes the current VISION-017 question,
ProblemEvidenceBundle, semantic projection, solver request, and `ocr_layout_solver` TrackResult as
independent raw-byte authorities. It emits one `ConsistencyReport` and one `rule_validator`
TrackResult.

The validator checks only the admitted candidate's question binding, quantity, unit, numeric and
answer format, semantic-evidence provenance, and fail-closed review disposition. It does not infer
an answer, read a scale, understand arbitrary units, call a provider, compare Track A/B/C results,
compile a DecisionRecord, approve review, or write delivery/WPF/trust/readiness state.

## Considered approaches

1. **Independent Track C runtime (selected).** Keep the validator request, report, and TrackResult
   separate from the solver. This preserves independent authority, allows isolated mutation tests,
   and matches the canonical `TrackResult` spine.
2. **Embed checks in the OCR layout solver (rejected).** This is smaller in file count but makes
   Track B attest its own output and prevents later orchestration from distinguishing solver and
   validator provenance.
3. **Compile a DecisionRecord immediately (rejected).** This would mix validation with Track
   orchestration and acceptance policy before a real Track A/B/C runtime exists.

## Inputs and binding

`SyntheticTrackValidatorRequest` binds the following canonical artifacts by repository-relative
reference and raw-byte SHA-256:

- VISION-017 `VisualSyntheticQuestion`;
- VISION-017 `ProblemEvidenceBundle`;
- VISION-016 semantic projection result;
- VISION-017 OCR layout solver request;
- VISION-017 Track B result;
- the deterministic validator policy hash.

The runtime accepts only the fixed canonical request. At compilation time it reloads every input,
validates current bytes against the request, and rechecks cross-authority identity rather than
trusting the Track B result's assertions.

## Deterministic checks

The canonical `ConsistencyReport.checks` contains exactly these pass/fail checks:

1. `question_binding_exact`: question id/ref/subject and question authority hash are identical
   across request, bundle, and Track B.
2. `quantity_binding_exact`: Track B quantity equals the explicit question quantity.
3. `unit_binding_exact`: Track B unit id/symbol equal the explicit question unit and its token is
   present as a whole token in the question text.
4. `numeric_format_valid`: Track B numeric value uses the admitted ASCII-decimal grammar.
5. `answer_format_exact`: candidate is exactly one normalized numeric value, one ASCII space, and
   the explicit unit symbol.
6. `semantic_evidence_exact`: bundle, solver request, and Track B provenance bind the current
   projection bytes, projection id, role, recognized text, solver-request bytes, and solver policy.
7. `review_boundary_preserved`: Track B stays high-risk, review-required, unapproved, untrusted,
   controls-not-verified, ineligible, and has no optimization candidates.

Any failed check produces a blocking validator finding, `groundingSufficient=false`, and
`recommendedDecisionReasons` containing `rule_validator_failed` plus
`acceptance_tier_unverified`. The canonical fixture has all checks passing, but still recommends
`acceptance_tier_unverified` and remains review-required because synthetic validation is not
acceptance. Its `groundingSufficient=true` means only that the five current public synthetic
authorities are complete for these seven limited checks; it is not real-question grounding proof.

## Outputs and trust boundary

The Track C result uses `trackType=rule_validator`. Its answer field records a validation summary,
not a second answer candidate. It references the ConsistencyReport through `stageArtifactRefs`,
records validator/input provenance, and mirrors any blocking checks into `validatorFindings`.

Even with all checks passing, the canonical Track C result is fixed to:

- `risk.level=high` and `reviewRequired=true`;
- `humanApproved=false`, `trusted=false`, and `visualReviewPassed=null`;
- controls `not_verified`, `eligible=false`, and `optimizationCandidateRefs=[]`;
- local deterministic provenance with `liveProvider=false` and `cloudEgress=false`.

No DecisionRecord is emitted. A passing Track C report cannot clear the VISION-017 blocking review
finding, project delivery trust, or attest readiness controls.

## Runtime and failure behavior

Compilation rejects malformed or stale request/input hashes, duplicate or missing semantic
projections, cross-question/case/subject/crop drift, non-canonical interpretation/provenance, and
review-boundary relaxation. Canonical outputs are deterministic and byte-exact.

Runtime output is a new external directory containing both artifacts. It rejects an existing
output directory, lexical repository output, and an external junction that physically resolves
into repository authority. Both files are staged, schema-validated, and promoted together; a
failure leaves no partial output.

## Testing and verification

Focused tests cover the positive seven-check report, each check's principal failure mode, source
hash and embedded-provenance drift, fixed canonical request admission, byte-exact replay, external
atomic directory output, existing-output rejection, repository-output rejection, junction
rejection, and staged-output cleanup.

Repository verification follows the fixed order:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Follow-on boundary

The next slice may establish real Track A/B/C orchestration, comparison/conflict/degradation, and
an evidence compiler runtime. That slice must keep source TrackResults independent and must not
project trust without the existing DecisionRecord/review/readiness gates.

## Rollback

Remove only VISION-018 request/report schemas or additive schema fields, tool, canonical request/
ConsistencyReport/Track C artifacts, validator/hotspot wiring, strategy increments, and evidence.
Preserve VISION-007 through VISION-017 authorities and commit `c291f9d`, `.env`, local OCR/renderer
environments, gateway settings, delivery/review authorities, readiness receipts, WPF state,
flywheel authorities, and sample authorities.
