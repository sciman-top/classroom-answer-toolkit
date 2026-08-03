# Visual Local Crop Runtime Plan

## Scope

`VISION-022` binds the VISION-021 proposal result and VISION-020 normalized pixels, then emits a
1x pixel-preserving and 2x nearest-neighbor PNG for every admitted nonsemantic content block.

The canonical two proposals produce four crops: 53x65/106x130 and 386x26/772x52. Every artifact
binds proposal id, source bbox, scale, raw bytes, decoded pixels, dimensions, and interpolation.
The 2x image is deterministic enlargement, not recovered detail or evidence of OCR improvement.

Runtime accepts only the current canonical request, rejects invalid bboxes and source drift, stages
all four PNGs plus result, rechecks staged bytes and input snapshots, and atomically promotes a new
external directory. It performs no network access.

Candidates remain nonsemantic: `semanticDisposition=not_inferred`, `visualRegionDisposition=
not_generated`, `trackDisposition=not_integrated`, review required, not accepted, controls=
`not_verified`, `eligible=false`, and no `OptimizationCandidate`.

Verification uses focused path/hash/bounds/scale/replay/atomic/tamper tests, schema/assets validation,
visual crop inspection, and the fixed build/test/assets/hotspot order. Follow-on classification and
axis/table/tick/legend/component semantics require separate authority and real-data benchmarks.

Rollback removes only VISION-022 schemas/tool/fixtures/integration/docs/evidence and preserves
VISION-007 through VISION-021 authorities, commit `4c302bb`, local environments, and readiness state.
