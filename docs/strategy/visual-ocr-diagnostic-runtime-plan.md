# Visual OCR Diagnostic Runtime Plan

## Goal

`VISION-011` establishes a provider-neutral, hash-bound diagnostic over committed VISION-009 OCR observations and text declarations owned by the deterministic VISION-007 renderer. It measures exact-text detection behavior on three public synthetic fixtures without claiming human ground truth, production OCR quality, layout semantics, or Track B integration.

## Authority and contracts

- `VisualSyntheticTextTruth` binds one VISION-007 source image, scale-2 crop, preprocessing result, and the renderer implementation bytes that explicitly declare the fixture text and coordinates.
- each truth label records stable ID, exact text, source-pixel bbox, crop-pixel bbox, and one visibility disposition: `fully_visible`, `partially_clipped`, or `outside_crop`.
- `VisualOcrDiagnosticCaseInventory` is the only runtime admission authority and binds each truth artifact, VISION-009 observation result, and expected report inputs by canonical ref and raw-byte SHA-256.
- `VisualOcrDiagnosticReport` contains only refs, match refs, counts, availability-aware ratios, negative dispositions, and local deterministic provenance. It does not copy observed text.
- all inputs remain `synthetic_fixture/public`; cloud egress is disabled; no real exam, teacher, or student data is admitted.

## Frozen diagnostic policy

- only `fully_visible` truth labels enter the recall denominator. `partially_clipped` and `outside_crop` declarations cannot contribute a true positive or false negative.
- convert each OCR quad to axis-aligned bounds and require positive-area intersection with the declared crop bbox.
- a scorable truth label matches only an unmatched OCR observation with exact, case-sensitive UTF-8 text and positive-area intersection. Truth-label ID then observation ID order is deterministic.
- an unmatched observation that exactly matches and overlaps a partially clipped label is `unscored`; every other unmatched observation is a false positive. Outside-crop labels cannot shield an observation.
- duplicate scorable truth text, invalid/degenerate/external bounds, ambiguous repeated match candidates, authority drift, or computed-field drift fail closed.
- precision and recall are represented as `{ available, value }`; a zero denominator requires `available=false` and no value. No smoothing or inferred score is allowed.

## Result boundary

- `diagnosticStatus=completed`
- `diagnosticScope=generator_declared_synthetic_fixture`
- `acceptanceDisposition=not_accepted`
- `requiresHumanReview=true`
- `layoutDisposition=not_inferred`
- `semanticDisposition=not_inferred`
- `trackDisposition=not_integrated`
- provenance is `deterministic_diagnostic / liveProvider=false / cloudEgress=false`

These fields are schema constants and semantic invariants. The report is not a model acceptance artifact, association runtime, layout parse, FigureUnderstandingResult, evidence bundle, TrackResult, DecisionRecord, or release qualification.

## Tasks

### Task 1: truth and report contracts

- add truth, case-inventory, and report schemas with exact upstream bindings, visibility rules, availability-aware metrics, and negative dispositions.
- acceptance: human/live/accepted/layout/semantic/Track positive claims fail schema or semantic validation.
- dependencies: VISION-007 and VISION-009.

### Task 2: deterministic compiler

- add a focused local tool that validates the complete VISION-007/009 authorities, renderer bytes, canonical truth/inventory coverage, bounds, matching, metrics, and external atomic output.
- acceptance: no caller-selected inventory, no copied fixture root, no fuzzy normalization, no confidence threshold, no elapsed data, and no upstream mutation.

### Task 3: canonical synthetic diagnostics

- materialize three truth artifacts from the existing renderer declarations and compile one canonical report with per-subject metrics.
- acceptance: truth/inventory/report bytes are stable and hash-bound; independent processes reproduce the report bytes.

### Task 4: repository gates and evidence

- include schemas and fixtures in asset validation, add negative boundary mutations, and wire focused tests plus canonical validation into the hotspot.
- run independent review, fixed-order full gates, evidence capture, commit, push, and remote parity.

## Rollback and boundary

Rollback only the VISION-011 schemas, tool, truth/inventory/report fixtures, validator/hotspot wiring, strategy increments, and evidence. Preserve VISION-007/008/009/010 authorities, `.env`, the OCR venv, gateway, readiness receipt, sample flywheel, and generated sample authorities.

This slice does not claim human ground truth, production OCR accuracy, OCR acceptance, OCR-region association, layout semantics, FigureUnderstanding, ProblemEvidenceBundle, Track B, workflow integration, live gateway verification, or live acceptance. It enables no cloud egress, uses no real data, generates no `OptimizationCandidate`, and leaves `ReadinessControlReceipt=unattested_local_record`, controls `not_verified`, and `eligible=false`.
