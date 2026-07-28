# Visual Text-region Diagnostic Runtime Plan

## Purpose

`VISION-012` establishes a provider-neutral, hash-bound diagnostic over committed VISION-008 heuristic text-region candidates and the generator-declared synthetic truth introduced by VISION-011. It measures spatial proposal coverage on three public synthetic fixtures without recognizing text, selecting OCR-region associations, inferring layout semantics, or producing Track B evidence.

## Authority chain

The canonical authority is a complete case inventory under `eval/visual-text-region-diagnostics/cases/`. Each entry binds one committed VISION-008 structure extraction result and one committed VISION-011 truth artifact by canonical repository ref and raw-byte SHA-256. Both upstream validators must pass, their inventory/result/truth bytes must remain stable through compilation and output promotion, and both inputs must bind the same case, subject pack, fixture kind, crop raw bytes, decoded RGB pixel hash, scale, and dimensions.

Runtime output is a new directory outside the repository. Canonical authority coverage is exact: nested entries, symlink/junction entries, hardlink aliases, missing files, extra files, copied roots, path escapes, or changed physical identity fail closed. The canonical report is recompiled from current authority and compared byte-for-byte.

## Matching policy

- coordinate space is `crop_pixel`; rectangles use half-open bounds and require positive-area intersection.
- only `fully_visible` truth labels are scorable.
- one candidate with positive overlap against one fully-visible truth forms a diagnostic match.
- a candidate that overlaps one or more `partially_clipped` labels but no fully-visible truth is unscored.
- `outside_crop` truth has no crop bbox and never shields a candidate from false-positive accounting.
- one candidate overlapping multiple fully-visible labels, or one fully-visible label overlapping multiple candidates, is ambiguous and fails closed.
- ordering is case inventory order, then truth label ID, then candidate ID. Areas and ratios use stable deterministic rounding.
- the report contains truth and candidate refs, bounds, intersection area, and coverage ratios, but never copies truth text or invents recognized text.

## Metrics and expected canonical result

Per case and subject pack, report scorable truth, detected truth, false negatives, candidate count, matched candidates, unscored candidates, false positives, and precision/recall with explicit availability. A zero denominator is unavailable.

The admitted fixtures are expected to produce:

| Case | Scorable truth | Detected | Candidates | Matched | Unscored | False positive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `math-function-graph` | 1 | 1 | 1 | 1 | 0 | 0 |
| `junior-instrument-scale` | 0 | 0 | 1 | 0 | 1 | 0 |
| `senior-circuit-label` | 2 | 2 | 23 | 2 | 21 | 0 |
| total | 3 | 3 | 25 | 3 | 22 | 0 |

Total precision and recall are both `1`; the junior denominators are unavailable. These numbers only describe proposal coverage for the frozen synthetic fixtures and are not a real-region benchmark or acceptance result.

## Fixed dispositions and provenance

The report is fixed to `diagnosticStatus=completed`, `diagnosticScope=generator_declared_synthetic_fixture`, `candidateKind=text_region_candidate`, `acceptanceDisposition=not_accepted`, `requiresHumanReview=true`, `ocrDisposition=not_inferred`, `associationDisposition=not_decided`, `layoutDisposition=not_inferred`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.

Engine provenance is deterministic local execution with `liveProvider=false` and `cloudEgress=false`. No `.env`, provider secret, real paper, teacher data, student data, or live request is consumed.

## Verification

Focused tests cover the canonical metrics, positive-area and edge-touch behavior, partial unscored and outside false-positive behavior, ambiguity, zero denominators, upstream crop/case/hash drift, inventory/result/truth/report byte drift, canonical coverage, nested/symlink/hardlink aliases, copied roots, mid-run mutation, staged output tamper, deterministic process replay, runtime identity, repository output rejection, and positive OCR/association/layout/semantic/Track/cloud/live state rejection.

Repository closeout follows the fixed order: build, .NET tests, assets, cross-subject validation, and `scripts/check-toolchain.ps1`. AI gateway config validation remains a separate config-only check with cloud egress disabled.

## Rollback and acceptance boundary

Rollback only the VISION-012 schemas, tool, inventory/report fixtures, validator/hotspot wiring, strategy increments, and evidence. Preserve VISION-007/008/009/010/011 authorities, `.env`, OCR environments, gateway config, readiness receipt, sample flywheel, generated candidates, and teacher feedback authorities.

This slice does not claim human ground truth, production proposal quality, recognized text, OCR correctness, OCR-region association, layout semantics, FigureUnderstanding, ProblemEvidenceBundle, Track B, workflow integration, live gateway verification, or live acceptance. It enables no cloud egress, uses no real data, generates no `OptimizationCandidate`, and leaves `ReadinessControlReceipt=unattested_local_record`, controls `not_verified`, and `eligible=false`.
