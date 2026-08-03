# Visual Scale Lattice Runtime Plan

## Boundary

VISION-025 compiles one explicit public synthetic scale-lattice declaration against current
VISION-024 component semantics and VISION-008 connected-region geometry. The declaration identifies
the horizontal major/minor tick inventory and subdivision count, but does not contain an expected
pointer index, physical quantity, unit, scale labels, or answer.

The canonical image has no numeric labels or unit. Its OCR observation is `+++++++++`; that text is
not admitted as calibration authority. The runtime can therefore produce only a relative subdivision
index, never a physical reading.

## Geometry Contract

1. Inclusive bbox centers are represented as doubled-pixel integers, avoiding float ambiguity.
2. Five ordered major components must form a regular 240 doubled-pixel (120 px) spacing.
3. Five subdivisions per major interval produce a 48 doubled-pixel (24 px) step.
4. Fifteen declared visible minor regions must land in their slots within one doubled pixel.
5. The pointer center must independently align to a non-tick slot; canonical geometry derives index 11.

The number `11` means only “eleven subdivision steps from the first declared major tick.” It has no
physical quantity or unit and cannot be used as an answer candidate.

## Fail-Closed Invariants

- Declaration, VISION-024 result, and VISION-008 result current raw bytes must match exactly.
- Major order/spacing and minor region/slot uniqueness, bboxes, tolerance, and coverage are fixed.
- Pointer alignment must be derived from geometry and cannot collide with a declared tick slot.
- Physical reading, quantity, unit, question binding, Track, answer, acceptance, controls,
  eligibility, optimization, provider, or cloud-egress escalation is rejected.
- Runtime accepts only the canonical request, writes to a new external directory, rereads staged
  bytes and input snapshots, and atomically promotes one result.

## Verification

- Python focused tests cover relative index derivation, declaration/source drift, geometry/slot
  coverage, positive-state escalation, canonical identity, output containment, staged tamper,
  input-snapshot drift, and byte-exact replay.
- `validate:assets` validates the three schemas and relative-only boundary.
- `check-toolchain.ps1` runs focused tests and canonical fixture validation in the hotspot gate.

## Truth Boundary

This slice is public synthetic and repo-side only. It does not use real papers, teacher/student data,
cloud egress, or live providers. `ReadinessControlReceipt=unattested_local_record`, controls remain
`not_verified`, `eligible=false`, and no `OptimizationCandidate` is generated. Physical reading,
workflow integration, gateway verification, workstation acceptance, and live acceptance remain open.

## Rollback

Rollback the VISION-025 atomic commit, removing only its schemas, tool, fixtures, asset/hotspot
wiring, strategy increments, and evidence. Preserve all VISION-007 through VISION-024 authorities,
`.env`, local OCR/runtime environments, gateway, delivery/review, readiness, flywheel, and samples.
