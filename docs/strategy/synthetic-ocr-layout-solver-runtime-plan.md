# Synthetic OCR Layout Solver Runtime Plan

## Scope

`VISION-017` establishes the first public synthetic question/evidence bundle that consumes the
VISION-016 semantic projection as one input to an `ocr_layout_solver` `TrackResult`. The admitted
case is limited to `junior-readable-measurement`: the bound OCR observation supplies `12`, while
an independent synthetic question authority explicitly supplies quantity `length` and unit
`centimetre / cm`.

This slice proves deterministic Track B plumbing for one declared case. It does not prove general
question parsing, arbitrary numeric or unit understanding, scale reading, layout inference,
FigureUnderstanding, Track A/C orchestration, answer correctness on real data, delivery trust,
WPF workflow integration, gateway live verification, or workstation/live acceptance.

## Selected approach

Keep the authorities independent and bind them through raw-byte SHA-256:

1. `VisualSyntheticQuestion` declares the public synthetic prompt, exact question identity,
   crop binding, quantity kind, required semantic role, and the unit token that is visibly present
   in the prompt.
2. `ProblemEvidenceBundle` binds that question authority and the existing VISION-016 projection.
3. `OcrLayoutSolverRequest` binds the question, evidence bundle, projection, expected
   interpretation, and deterministic solver policy.
4. The solver admits only one `measurement_reading`, parses its OCR-bound `recognizedText` with
   a narrow ASCII-decimal grammar, combines it with the explicitly declared unit, and emits one
   `ocr_layout_solver` `TrackResult` answer candidate.

The numeric value comes only from VISION-016's bound OCR observation. Quantity and unit come only
from the explicit question authority. Neither geometry, OCR confidence, file name, subject-pack
heuristics, expected-answer data, nor delivery state may fill a missing authority.

## Contracts

### VisualSyntheticQuestion

The first authority is fixed to public `synthetic_fixture` data and contains:

- stable `questionId`, `questionRef`, `caseId`, and subject pack;
- prompt text containing the exact unit token `centimetres`;
- raw-byte and decoded-pixel crop hashes copied from the VISION-016 crop binding;
- `quantityKind=length`, `semanticRoleRequired=measurement_reading`, and unit `centimetre / cm`;
- `valueSource=bound_semantic_projection_recognized_text` and
  `unitSource=explicit_question_text`;
- local, non-live, no-cloud provenance.

The question authority does not contain an expected numeric answer or trust state.

### ProblemEvidenceBundle

The bundle uses the existing canonical contract and adds explicit `questionBinding` and
`semanticEvidence` fields. It binds question and projection raw bytes, retains the crop and
projection evidence refs, sets stable synthetic binding, and remains high risk with review
required. Its provenance is `synthetic_question_evidence_bundle` and acceptance tier is only
`repo_side_synthetic_diagnostic`.

### OcrLayoutSolverRequest and TrackResult

The request binds all three input authorities plus the solver policy hash. The `TrackResult`
records independent:

- exact question binding;
- quantity, numeric value, unit, semantic role, and interpretation mode;
- answer-candidate provenance across request/question/bundle/projection/policy hashes;
- local deterministic solver provenance;
- blocking review semantics.

The canonical candidate is `12 cm`. It is `candidateSourceType=generated`, not a historical or
teacher-approved answer.

## Fail-closed behavior

Compilation rejects:

- question, question reference, subject pack, case, crop, or raw-byte hash drift;
- a non-public, live-provider, cloud-egress, or non-synthetic question authority;
- a unit token not explicitly present in the prompt;
- a missing, duplicate, non-projected, or non-`measurement_reading` semantic projection;
- OCR-bound text outside the admitted ASCII decimal grammar;
- evidence-bundle or request bindings that no longer match current authority bytes;
- any request that relaxes human review, controls, eligibility, or optimization dispositions;
- runtime requests outside the fixed canonical authority, lexical repository output, or an
  external junction that physically resolves back into repository authority.

Runtime output is written atomically to a new external path. There is no confidence/geometry/name
fallback and no repository-authority overwrite path.

## Review and acceptance boundary

The emitted Track B result is fixed to:

- `risk.level=high` and `reviewRequired=true`;
- blocking validator finding `synthetic_track_b_requires_review`;
- `reviewDisposition.status=review_required`;
- `humanApproved=false`, `trusted=false`, and `visualReviewPassed=null`;
- controls `not_verified`, `eligible=false`, and `optimizationCandidateRefs=[]`.

No `DecisionRecord` is emitted by this slice. Passing deterministic compilation does not approve
the candidate, change delivery trust, or attest workstation controls.

## Testing and verification

Focused tests cover positive provenance, question-byte drift, missing explicit unit, non-numeric
OCR text, semantic-role mismatch, evidence-binding drift, canonical byte-exact replay, fixed
request admission, external atomic output, lexical repository-output rejection, and physical
junction rejection.

Repository verification follows the fixed order:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Follow-on boundary

The next independent slice is Track C validation of this candidate's unit, format, quantity, and
evidence bindings. Only later slices may orchestrate real Track A/B/C providers, compare or
degrade conflicting results, compile a DecisionRecord, or integrate the workflow into WPF.

## Rollback

Remove only the VISION-017 schemas, tool, canonical question/evidence/request/Track B artifacts,
asset/hotspot wiring, strategy increments, and evidence. Preserve all VISION-007 through
VISION-016 authority bytes, `.env`, OCR environments, gateway settings, delivery/review
authority, readiness receipts, WPF state, flywheel authority, and canonical samples.
