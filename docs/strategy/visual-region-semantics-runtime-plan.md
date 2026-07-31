# Visual Region Semantics Runtime Plan

## Boundary

VISION-023 compiles explicit public synthetic region semantics onto current VISION-021 proposals and
VISION-022 crop bytes. The semantic authority is a separate declaration. Proposal heuristics, image
pixels, filenames, OCR text, question text, and known answers are not semantic inputs.

The canonical declaration is deliberately narrow:

- `content-block-001 -> text_area / measurement_reading / recognized_value_component`
- `content-block-002 -> scale_area / measurement_scale_baseline / scale_baseline_component`

This is not a generic region classifier and does not establish question binding, axis/table/tick/
legend semantics, FigureUnderstanding, Track input, an answer candidate, review approval, or trust.

## Authority Chain

1. The declaration explicitly names each proposal, bbox, semantic tuple, and its two crop bindings.
2. The request binds declaration, proposal-result, and local-crop-result raw bytes.
3. The compiler reloads current VISION-021/022 authorities and the four actual PNGs.
4. Proposal kind/bbox and crop raw-byte/pixel/dimension/interpolation coverage must match exactly.
5. The result emits two VisualRegion-shaped artifacts with explicit declaration provenance.

`semanticDisposition=explicit_declared` means only that the explicit declaration was compiled. It is
not evidence that runtime inference occurred or that the declared semantics generalize.

## Fail-Closed Invariants

- Declaration coverage is exactly the two current proposals in canonical order.
- Each proposal has exactly one 1x pixel-preserving and one 2x nearest crop binding.
- Crossed, missing, duplicate, unsupported, stale, or mismatched declaration fields are rejected.
- Inference, question binding, Track, answer, acceptance, controls, eligibility, optimization, live
  provider, or cloud-egress escalation is rejected by runtime and schema boundaries.
- Runtime accepts only the canonical request and writes one result to a new external directory.
- Staged output bytes and every input snapshot are re-read before atomic directory promotion.

## Verification

- Python focused tests cover canonical compilation, crossed refs, unsupported role/type, stale crop
  hash/bbox, request/upstream drift, boundary escalation, canonical identity, output containment,
  staged tamper, and byte-exact replay.
- `validate:assets` validates declaration/request/result schemas and the explicit boundary projection.
- `check-toolchain.ps1` runs focused tests and canonical fixture validation in the hotspot gate.

## Truth Boundary

This slice is public synthetic and repo-side only. It does not use real papers, teacher/student data,
cloud egress, or live providers. `ReadinessControlReceipt=unattested_local_record`, controls remain
`not_verified`, `eligible=false`, and no `OptimizationCandidate` is generated. Workflow integration,
gateway verification, workstation acceptance, and live acceptance remain open.

## Rollback

Rollback the VISION-023 atomic commit, removing only its schemas, tool, fixtures, asset/hotspot wiring,
strategy increments, and evidence. Preserve all VISION-007 through VISION-022 authorities, `.env`,
local OCR/runtime environments, gateway, delivery/review, readiness, flywheel, and canonical samples.
