# Visual Spatial Observation Runtime Plan

## Goal

`VISION-010` establishes a provider-neutral, hash-bound local spatial observation runtime over the committed VISION-008 text-region candidates and same-case VISION-009 OCR observations. It exhaustively measures geometry between both untrusted diagnostic surfaces without selecting a match, inferring layout semantics, or creating Track B evidence.

## Authority and contracts

- `VisualSpatialObservationRequest` is separate from preprocessing, structure extraction, OCR, answer generation, delivery, and TrackResult contracts.
- the request binds one committed VISION-008 result and its same-case committed VISION-009 result by canonical artifact ref, raw-byte SHA-256, request ID, subject pack, fixture kind, and identical crop authority.
- `VisualSpatialObservationResult` contains only deterministic pairwise measurements between every `TextRegionCandidate` bbox and every OCR observation quad. Zero measurements are valid.
- the committed `VisualSpatialObservationCaseInventory` is the only runtime admission authority. A caller cannot select an alternate inventory or run a copied request root.
- inputs remain `synthetic_fixture/public`; cloud egress is disabled; no real exam, teacher, or student data is admitted.

## Frozen geometry policy

- convert each OCR quad to an axis-aligned bounds using its minimum and maximum x/y coordinates. Reject non-finite, negative, degenerate, or crop-external coordinates before measuring.
- treat structure bboxes as half-open axis-aligned rectangles. Reject degenerate or crop-external bboxes.
- enumerate the Cartesian product `textRegionCandidates x observations` in candidate-ID then observation-ID order.
- each measurement records both refs, OCR axis-aligned bounds, intersection area, intersection-over-region ratio, intersection-over-observation ratio, centroid-distance-squared, and exactly one geometry-only relation: `equal_bounds`, `observation_contains_region`, `region_contains_observation`, `overlap`, or `disjoint`.
- touching edges have zero intersection and are `disjoint`. Containment and equality require positive-area bounds. Numeric outputs use fixed rounding before stable JSON encoding.
- no threshold chooses a best match. No observed text is copied into the result, and no relation is renamed as a character, label, question number, axis, tick, wire, component, or subject concept.

## Result boundary

- `measurementStatus=completed`
- `associationDisposition=not_decided`
- `layoutDisposition=not_inferred`
- `semanticDisposition=not_inferred`
- `trackDisposition=not_integrated`
- `requiresHumanReview=true`
- provenance is `deterministic_geometry / liveProvider=false / cloudEgress=false`

These fields are schema constants and semantic invariants. A pairwise measurement is not an association decision, OCR correction, layout parse, FigureUnderstanding, evidence bundle, TrackResult, DecisionRecord, or correctness claim.

## Tasks

### Task 1: provider-neutral contract

- add request, result, and case-inventory schemas with exact upstream bindings, exhaustive measurement shape, negative dispositions, and local deterministic provenance.
- acceptance: delivery/generation fields are absent; positive association/layout/semantic/Track/live/cloud mutations fail schema validation.
- dependencies: VISION-008 and VISION-009.

### Task 2: deterministic local measurer

- add a focused tool that reuses canonical path/hash/atomic helpers, validates the complete VISION-008/009 authorities, checks identical crop bindings, computes exhaustive geometry, and writes only to a new directory outside the repository.
- acceptance: no caller-selected inventory, no input path alias, no threshold-based matching, no elapsed data, and no mutation of upstream authority.
- verification: focused tests for geometry edge cases, exhaustive coverage, ordering/rounding, authority/hash/path/alias drift, computed-field drift, and external atomic output.

### Task 3: canonical synthetic fixtures

- materialize three cases from the existing public synthetic authorities. Preserve the actual output, including zero measurements and disjoint geometry.
- acceptance: request/result/inventory bytes are stable and hash-bound; independent processes reproduce the same result bytes.
- dependencies: Tasks 1-2.

### Task 4: repository gates and evidence

- include schemas and fixtures in asset validation, add negative boundary mutations, and wire focused test plus canonical validation into the hotspot.
- run independent review, fixed-order full gates, evidence capture, commit, push, and remote parity.
- acceptance: controls remain `not_verified`, `eligible=false`, and every `optimizationCandidateRefs` surface remains empty or absent.

## Rollback and boundary

Rollback only the VISION-010 schemas, tool, fixtures, validator/hotspot wiring, strategy increments, and evidence. Preserve VISION-007/008/009 authorities, `.env`, the OCR venv, gateway, readiness receipt, sample flywheel, and generated sample authorities.

This slice does not claim OCR correctness, OCR acceptance, association correctness, layout semantics, FigureUnderstanding, ProblemEvidenceBundle, Track B, workflow integration, live gateway verification, or live acceptance. It enables no cloud egress, uses no real data, generates no `OptimizationCandidate`, and leaves `ReadinessControlReceipt=unattested_local_record`, controls `not_verified`, and `eligible=false`.
