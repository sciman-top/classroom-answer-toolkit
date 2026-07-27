# Visual OCR Observation Runtime Plan

## Goal

`VISION-009` establishes the first provider-neutral, hash-bound local OCR observation runtime over the three committed VISION-007 2x crops. It records what RapidOCR actually emits, including empty and visibly incorrect observations, without converting model confidence into correctness, semantic evidence, or Track B acceptance.

## Authority and contracts

- `VisualOcrObservationRequest` is separate from preprocessing, structure extraction, answer generation, delivery, and TrackResult contracts.
- the request binds the committed VISION-007 preprocessing result and scale=2 crop by raw-byte SHA-256, decoded RGB pixel SHA-256, dimensions, and case identity.
- the request also binds the same-case committed VISION-008 result by raw-byte SHA-256 as sibling evidence. OCR does not reinterpret or relabel its heuristic text-region candidates.
- `VisualOcrObservationCaseInventory` is the only runtime admission authority and binds request/result raw bytes plus the two upstream authorities.
- caller-selected inventory, copied request roots, alternate crops, or repository-owned output directories are rejected.

## Frozen local runtime

- engine: `rapidocr-onnxruntime 1.2.3` on CPU with ONNX Runtime `1.27.0`, OpenCV `5.0.0`, and Pillow `12.3.0`.
- invocation policy: whole canonical 2x crop; `box_thresh=0.5`, `unclip_ratio=1.6`, `text_score=0.5`; no extra cleanup, deskew, synthetic label injection, expected-text hint, network call, or cloud fallback.
- the three bundled detection/classification/recognition ONNX files are admitted only at their reviewed raw-byte SHA-256 values. Package/config/model/version drift fails closed before inference.
- elapsed timing is excluded from canonical results. Quadrilateral coordinates and confidence values are normalized and sorted before stable JSON encoding.

## Result semantics

- every observation records a stable ID, normalized quadrilateral, raw observed text, and model confidence. Zero observations is valid and explicit.
- current fixture output is diagnostic, not a label: the junior instrument crop emits `+++++++++`, while the math and senior circuit crops emit no observations under the frozen runtime.
- result state is fixed to `observationStatus=completed`, `groundTruthAvailable=false`, `acceptanceDisposition=not_evaluated`, `requiresHumanReview=true`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
- no accuracy, recall, correctness, OCR/image conflict, layout relation, question binding, FigureUnderstanding, ProblemEvidenceBundle, TrackResult, DecisionRecord, or trusted projection is computed.

## Verification and failure behavior

- three canonical cases must replay byte-exact in fresh processes on the admitted runtime and model hashes.
- schema validation and semantic validation reject positive acceptance, ground-truth claims, semantic/Track integration, cloud/live provenance, input/hash/model/config/version drift, path escape, symlink/junction/hardlink aliases, unlisted authority, computed-field drift, or repository output.
- runtime output is staged outside the repository and atomically renamed into a new destination.
- full fixed-order repository gates remain required.

## Implementation task breakdown

### Task 1: contract foundation

- add request, result, and case-inventory schemas with local-only provenance and fixed negative acceptance/semantic/Track state.
- acceptance: canonical shapes validate; ground-truth, accepted, semantic, Track, remote, live, and cloud mutations fail schema validation.
- verification: `npm --prefix tools/rule-compiler run validate:assets` after schema/fixture wiring.
- dependencies: none. Likely files: `prompts/shared/schemas/visual-ocr-observation-*.schema.json`.

### Task 2: admitted local observer

- add a focused tool that reuses canonical path/hash/atomic helpers, validates VISION-007/008 authorities, verifies package/component/config/model identity, runs frozen whole-crop RapidOCR, and normalizes observations.
- acceptance: no caller-selected inventory; no elapsed data; empty output is valid; output remains local-only and not evaluated.
- verification: focused Python tests for authority, environment/model drift, normalization, aliases, computed fields, and external atomic output.
- dependencies: Task 1. Likely files: `tools/visual-ocr-observer/`.

### Task 3: canonical diagnostic fixtures

- materialize three public `synthetic_fixture` request/result pairs and one exact-coverage inventory from committed upstream authorities.
- acceptance: math and senior cases preserve empty observations; junior preserves the raw `+++++++++` observation without claiming it is correct; all results replay byte-exact.
- verification: observer fixture validation in multiple fresh processes.
- dependencies: Task 2. Likely files: `eval/visual-ocr-observation/` and `.gitattributes`.

### Task 4: repository gates

- register schemas/fixtures and negative boundary mutations in asset validation; add focused tests and canonical replay to the hotspot.
- acceptance: all three contract families are counted; positive authority mutations fail; existing gates remain unchanged in meaning.
- verification: `validate:assets`, `validate:cross-subject`, and the focused observer suite.
- dependencies: Tasks 1-3. Likely files: `tools/rule-compiler/validate-assets.mjs`, `scripts/check-toolchain.ps1`.

### Task 5: closeout

- obtain independent five-axis review, resolve all Critical/Required findings, record N/A fields and truth boundaries, run full fixed-order gates, commit, push, and verify remote parity.
- acceptance: clean worktree; `HEAD == origin/main == remote/main`; ahead/behind `0/0`; evidence distinguishes repo-side completion from OCR acceptance, workflow integration, and live acceptance.
- dependencies: Tasks 1-4. Likely files: `docs/change-evidence/20260727-vision009-visual-ocr-observation.md`.

Checkpoint after Tasks 1-2: schema boundaries and environment/model admission are covered by focused negative tests. Checkpoint after Tasks 3-4: all canonical fixtures replay and repository contract gates pass. No implementation task may advance authority beyond the fixed result dispositions.

## Rollback and boundary

Rollback only the VISION-009 schemas, tool, fixtures, validator/hotspot wiring, strategy increments, and evidence. Do not modify VISION-007/008 authority, `.env`, the OCR venv, gateway, readiness receipt, or sample flywheel authorities.

This slice does not claim OCR correctness, OCR acceptance, layout semantics, Track B, workflow integration, live gateway verification, or live acceptance. It uses no real exam, teacher, or student data, enables no cloud egress, generates no `OptimizationCandidate`, and leaves controls `not_verified`, `ReadinessControlReceipt=unattested_local_record`, and `eligible=false`.
