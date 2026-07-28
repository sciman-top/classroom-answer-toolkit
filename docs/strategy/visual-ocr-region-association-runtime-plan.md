# Visual OCR-region Association Runtime Plan

## Scope

`VISION-014` establishes a provider-neutral, deterministic association diagnostic over the
committed VISION-008 text-region candidates, VISION-009 OCR observations, and VISION-010
exhaustive spatial measurements. It selects only geometry-supported one-to-one associations;
it does not correct OCR text, infer layout or subject semantics, or create Track B evidence.

## Risk-first authority finding

The three frozen public synthetic fixtures do not contain an honest positive canonical
association:

- `math-function-graph`: one text-region candidate and zero OCR observations;
- `junior-instrument-scale`: one candidate and one OCR observation, but their only measurement
  is `disjoint` with zero intersection;
- `senior-circuit-label`: twenty-three candidates and zero OCR observations.

The canonical VISION-014 result therefore records `unavailable / unmatched / unavailable`.
A positive one-to-one association and an ambiguous conflict are covered only by isolated
policy-level unit inputs. Those inputs are not canonical fixtures, generated samples, historical
samples, human labels, OCR truth, or acceptance evidence.

## Contracts and authority chain

- `VisualOcrRegionAssociationRequest` binds the same-case committed VISION-008, VISION-009,
  and VISION-010 results by canonical ref and raw-byte SHA-256, plus the shared scale-2 crop
  authority and a frozen policy.
- `VisualOcrRegionAssociationResult` records matched pairs by candidate, observation, and
  spatial-measurement refs; unmatched refs; availability-aware counts; and negative
  layout/semantic/Track dispositions. It never copies `observedText` or truth text.
- `VisualOcrRegionAssociationCaseInventory` is the only canonical admission authority and
  binds all three requests and expected results.
- `VisualOcrRegionAssociationReport` binds the inventory and results, then reports
  `matched / unmatched / ambiguous / unavailable` counts per subject pack and in total.
- VISION-011 generator-declared truth may be used only to assert that no OCR correctness or
  truth claim is projected. Association selection itself never uses truth labels or fixture text.

All authority is raw-byte SHA-256 bound. The runtime revalidates upstream canonical
inventories, path containment, physical identity, shared crop bytes/pixel hash/dimensions,
request/result/inventory/report bytes, snapshots before and after compilation, and staged output
before atomic promotion. Output is allowed only in a new directory outside the repository.

## Frozen association policy

- eligible edges are VISION-010 measurements with positive `intersectionArea` and a non-disjoint
  spatial relation;
- a match exists only when one observation has exactly one eligible candidate and that candidate
  has exactly one eligible observation;
- more than one eligible edge for either endpoint is an ambiguity and fails closed without
  publishing a result;
- observations and candidates present with no eligible edge are `unmatched`;
- zero observations or zero candidates makes the case `unavailable`; ratios with a zero
  denominator use `{ "available": false }` and never invent `0` or `1`;
- matching is deterministic by candidate ID and observation ID; distance is never used as a
  fallback and OCR confidence is never used as correctness.

## Canonical acceptance

1. The three subject packs independently report their actual frozen outcomes: two unavailable
   cases and one unmatched case, with zero canonical matches and zero ambiguity.
2. A policy-level positive one-to-one geometry input produces one association, while a
   many-to-one or one-to-many input fails closed. These tests do not enter canonical authority.
3. Empty observations, disjoint geometry, upstream/hash/path/alias/crop drift, incomplete
   Cartesian coverage, computed-field drift, positive layout/semantic/Track/live/cloud state,
   and staged-output tamper fail closed.
4. Schemas and canonical assets are validated by `validate:assets`; focused tests and canonical
   replay are included in `scripts/check-toolchain.ps1`.
5. The fixed full gate order remains build, .NET test, assets, cross-subject, and toolchain.

## Explicit non-goals

VISION-014 does not create recognized-text truth, OCR correctness, a real association benchmark,
layout relations, subject semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`,
`TrackResult`, `DecisionRecord`, delivery trust, WPF state, readiness authority, live gateway
proof, real-data acceptance, or `OptimizationCandidate`. It uses no real exam, teacher, or
student data and enables no cloud egress.

Gateway remains config plus synthetic request/failover contract verified; workflow is not
integrated; live is not accepted. `ReadinessControlReceipt` remains
`unattested_local_record`, toolchain/restricted-egress controls remain `not_verified`, and
`eligible=false`.

## Rollback

Rollback only the VISION-014 schemas, tool, canonical request/result/inventory/report assets,
validator/hotspot wiring, README/strategy increments, and change evidence. Preserve all
VISION-007 through VISION-013 authorities, `.env`, OCR environments, gateway configuration,
delivery/review authorities, readiness receipts, sample-flywheel authorities, and canonical
samples.
