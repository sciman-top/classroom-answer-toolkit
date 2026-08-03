# Synthetic Track Orchestration Runtime Plan

## Scope

`VISION-019` adds the first provider-neutral runtime that actually admits and orchestrates Track
A/B/C `TrackResult` artifacts. The canonical case reuses the VISION-017 question,
ProblemEvidenceBundle and Track B plus the VISION-018 Track C, and adds one independent public
synthetic Track A authority for the same `12 cm` candidate.

This slice proves runtime orchestration plumbing, not real provider execution. Track A is not a VLM
response, Track B is not a production OCR/layout solver result, and Track C is not a real-data
validator acceptance result.

## Selected design

The runtime is a source-admission and orchestration layer around the canonical decision compiler:

1. Read the current raw bytes for question, ProblemEvidenceBundle, and every source TrackResult.
2. Require exact repository-relative refs, SHA-256, type, id, evidence-bundle and question binding.
3. Require the fixed `vlm_direct / ocr_layout_solver / rule_validator` set; a request cannot shrink
   it to bypass missing-track degradation.
4. Compare Track A/B through the normalization exported by
   `tools/visual-evidence/decision-record.mjs`.
5. Report A/B agreement or conflict independently from complete/degraded track inventory.
6. Record Track C disposition separately from blocking findings on any source track.
7. Delegate the final `DecisionRecord` to the existing compiler, including required-track evidence
   loss. No second trust or acceptance policy is implemented.

The runtime emits a `TrackOrchestrationReport` and `DecisionRecord` together through one external
staging directory and atomic directory rename. Repository output, existing output, external
junctions resolving into repository authority, source hash drift, cross-question binding, duplicate
track types/ids, and reduced expected-track inventories fail closed.

## Canonical semantics

- Track A/B normalized candidates agree on `12 cm`.
- Track C has no blocking finding and is reported as `pass` for its seven limited checks.
- Track B still contains `synthetic_track_b_requires_review` as a blocking source finding. The
  orchestration report exposes that exact source, and the canonical DecisionRecord therefore keeps
  `rule_validator_failed` under the existing compiler semantics.
- High-risk synthetic evidence and `acceptance_tier_unverified` also remain active.
- The DecisionRecord is `review_required`, `trusted=false`, `visualReviewPassed=null`, and routes to
  `high_risk_approval`; it does not contain an accepted answer.
- Controls remain `not_verified`, `eligible=false`, cloud egress remains disabled, and no
  `OptimizationCandidate` is generated.

## Verification

Focused tests cover exact three-track admission, normalized agreement, conflict, missing Track A,
missing Track C while preserving A/B agreement, Track C blocking findings, source-byte drift,
cross-question binding, duplicate tracks, required-set shrink attempts, byte-exact canonical replay,
atomic external output, existing/repository output rejection, external request rejection, and
junction containment.

The fixed repository gate remains:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Acceptance boundary

`repo-side done` for this slice means the source admission, comparison, degradation, Track C
projection, existing DecisionRecord compilation, canonical replay, and external atomic runtime are
implemented and pass repository gates. It does not mean provider Track A/B/C is live, WPF uses this
runtime, review has been approved, the delivery manifest has changed, gateway/workstation checks
have passed, or any real question has been accepted.

## Follow-on boundary

The next implementation slice may expand production image input: automatic region proposal,
deskew/denoise/perspective handling, multi-scale/local high-resolution crops, and explicit
axis/table/tick/legend/component semantic artifacts. Native `docx -> NormalizedPage` remains a
separate adapter boundary. Real provider orchestration and real-data acceptance require legal data,
credentials, and their own evidence; synthetic orchestration cannot substitute for them.

## Rollback

Remove only the VISION-019 canonical EOL rule, request/report schemas, track orchestrator, Track A/request/report/
DecisionRecord fixtures, the additive DecisionRecord required-track hook, hotspot wiring, strategy
increments, and evidence. Preserve VISION-007 through VISION-018 authorities and commits `c291f9d`
and `9c0d4f5`, local ignored OCR/renderer environments, `.env`, gateway/review/readiness/WPF/flywheel
authorities, and all sample authorities.
