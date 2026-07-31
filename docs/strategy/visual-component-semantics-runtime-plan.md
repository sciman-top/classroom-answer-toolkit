# Visual Component Semantics Runtime Plan

## Boundary

VISION-024 compiles explicit public synthetic component semantics onto the current
`junior-instrument-scale` VISION-008 structure result and VISION-007 2x crop. The semantic authority
is a separate declaration. Image pixels, candidate geometry, filenames, OCR text, question text,
and known answers are not component-type inference inputs.

The canonical declaration is deliberately narrow:

- `line-007 + line-008 -> scale-component-001 / pointer_indicator`
- `line-009..line-013 + line-014..line-018 -> five ordered major_tick_mark edge pairs`

This is not an automatic pointer/tick detector and does not establish a scale range, division value,
numeric reading, FigureUnderstanding, question binding, Track input, answer candidate, approval, or
trust.

## Authority Chain

1. The declaration explicitly names each component, type, order, and exact pair of line candidates.
2. The request binds declaration, structure-result, preprocessing-result, and actual 2x crop bytes.
3. The compiler reloads the current authorities and revalidates raw-byte and decoded-pixel hashes.
4. Every candidate id, segment geometry, pair uniqueness, and computed component bbox must match.
5. The result emits six bounded component groups with explicit declaration provenance.

`semanticDisposition=explicit_declared` means only that the explicit declaration was compiled. It is
not evidence that runtime inference occurred or that the declarations generalize.

## Fail-Closed Invariants

- Declaration coverage is exactly one pointer pair and five ordered major-tick pairs.
- The twelve line-candidate refs are unique and must exist in the current structure authority.
- Crossed, duplicate, unsupported, stale, or mismatched declaration/source fields are rejected.
- Scale interpretation, reading, FigureUnderstanding, question binding, Track, answer, acceptance,
  controls, eligibility, optimization, live-provider, or cloud-egress escalation is rejected.
- Runtime accepts only the canonical request and writes one result to a new external directory.
- Staged output bytes and every canonical input snapshot are re-read before atomic promotion.

## Verification

- Python focused tests cover canonical compilation, crossed/duplicate refs, unsupported type,
  source/hash drift, boundary escalation, canonical identity, output containment, junction alias,
  staged tamper, input-snapshot drift, and byte-exact replay.
- `validate:assets` validates the three schemas and explicit canonical boundary projection.
- `check-toolchain.ps1` runs focused tests and canonical fixture validation in the hotspot gate.

## Truth Boundary

This slice is public synthetic and repo-side only. It does not use real papers, teacher/student data,
cloud egress, or live providers. `ReadinessControlReceipt=unattested_local_record`, controls remain
`not_verified`, `eligible=false`, and no `OptimizationCandidate` is generated. Workflow integration,
gateway verification, workstation acceptance, and live acceptance remain open.

## Rollback

Rollback the VISION-024 atomic commit, removing only its schemas, tool, fixtures, asset/hotspot
wiring, strategy increments, and evidence. Preserve all VISION-007 through VISION-023 authorities,
`.env`, local OCR/runtime environments, gateway, delivery/review, readiness, flywheel, and canonical
samples.
