# VISION-016 Visual Semantic Projection Evidence

## Goal and authority boundary

- Goal: project one explicitly declared `measurement_reading` role only when the current VISION-011, VISION-012, and VISION-014 authorities form one exact truth/OCR/candidate association triangle.
- Admitted case: `junior-readable-measurement / junior-physics-answer`.
- Role source: `VisualSyntheticSemanticDeclaration`; no role is inferred from truth text, OCR confidence, geometry, file names, or subject rules.
- Recognized-text source: the bound VISION-009 OCR observation only.
- Not claimed: numeric or unit understanding, layout semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, an answer candidate, solver correctness, delivery trust, WPF workflow integration, gateway live verification, real-data quality, or workstation/live acceptance.
- State preserved: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`, `eligible=false`, cloud egress disabled, `.env` unchanged, and no `OptimizationCandidate`.

## Canonical projection

The single projection binds:

- `truth-label-001 -> ocr-observation-001` with `exact_text_positive_overlap`;
- `truth-label-001 -> text-region-001` with `positive_overlap`;
- `ocr-region-association-001` between those exact endpoints;
- semantic role `measurement_reading` from declaration;
- recognized text `12` from `ocr-observation-001`.

Canonical raw-byte SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| declaration | `3f50ae04ff2c502d5ca851168ebaf8a9f208063efbf71e63ca7a09058d71bc9d` |
| request | `7801b5ea7ba9bb47a79bd7ad303f925948302f8c1271e4226eb229ba80cdb80f` |
| result | `f7c84424a4248a9e7a9bf6d3c9ea17278202579f6d0b2c665bfaf08028b9bfe7` |
| inventory | `a244007a51a2a90731e962852995b623a26f3e4631c746e27349c4253c738d67` |
| report | `7398a40d3d474328833f8839d18786985552031b75721ec6cca0e4ccc344d5bf` |

The report records one admitted case, one projected case, zero withheld cases, and zero unavailable cases. These are fixture coverage counts, not accuracy or acceptance metrics.

## Focused verification

- Projector suite: 22 passed, 0 failed.
- Repeated temporary materialization produced byte-exact declaration/request/result/inventory/report outputs.
- Mutation coverage includes missing, duplicate, crossed, unmatched, unavailable, and ambiguous truth/observation/candidate/association endpoints; independent role/text sources; hash, crop, path escape, physical hardlink alias, computed-field, disposition, TOCTOU, and staged-output drift.
- Runtime output was atomically promoted to a new external directory; repository output and pre-existing output directories were rejected.
- Schema boundary mutations rejected positive acceptance, inferred role/text sources, layout/FigureUnderstanding/Track/trust/WPF/live/control/eligibility promotion, optimization candidates, live provider, cloud egress, and zero or duplicate inventory coverage.
- Asset validation after integration: 156 files, 3 subject packs, 3 snapshots.
- VISION-007 through VISION-015 canonical authority diff from the approved VISION-016 plan base: none.

## Five-axis review

Review covered tests first, then correctness, readability, architecture, security, and performance. Required findings and resolutions:

1. Exact endpoint lookup initially allowed extra unrelated endpoints. It now requires exactly one unique truth label, OCR match, text-region match, association, and OCR observation, with missing/duplicate/ambiguous regressions.
2. The compiler initially relied too heavily on prior upstream validators for OCR-result bindings and association state. It now rechecks truth/report/OCR/association byte bindings plus matched and zero-ambiguity state before projection.
3. Fixture materialization initially rejected an already populated canonical root. It now validates existing authority structure first, rewrites every known artifact atomically, and proves two consecutive materializations are byte-exact.
4. An unused authority path map and a no-op truth-label variable were removed.

No Critical or Required finding remains. No dependency was added.

## Repository gate evidence

Final fixed-order verification ran from `D:\CODE\classroom-answer-toolkit` on the reviewed implementation tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 156 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 987.8 seconds |

The system lookup remains incompatible with exact `global.json` SDK `10.0.301`; verification used the already prepared `%TEMP%\classroom-toolkit-dotnet-10.0.301` runtime by setting `DOTNET_ROOT` and prepending `PATH` only inside gate command processes. Bootstrap was not run; `global.json` and system SDK installations were unchanged.

The hotspot re-ran the projector's 22 tests and one canonical fixture validator, all existing visual packages, assets, cross-subject checks, renderer/eval paths, and gateway configuration. Gateway template validation allowed missing example secrets, reported cloud egress disabled, made no live request, and did not modify `.env`.

## Rollback

Revert the VISION-016 evidence commit, then the review-fix, strategy, integration, canonical test authority, runtime, schema, implementation-plan, and design commits in reverse order. Remove only VISION-016 tool/eval/schema/validator/hotspot/strategy additions. Preserve every VISION-007 through VISION-015 authority byte, `.env`, OCR environments, gateway settings, delivery/review authority, readiness receipts, flywheel authority, and canonical sample authority.
