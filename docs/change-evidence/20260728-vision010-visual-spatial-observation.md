# VISION-010 Local Visual Spatial Observation Evidence

## Goal and boundary

- landing point: VISION-008 provided hash-bound nonsemantic `TextRegionCandidate` bboxes and VISION-009 provided same-case local OCR observation quads, but the repository had no admitted contract for measuring their geometry together.
- target: establish provider-neutral request/result/inventory contracts and a deterministic local runtime that exhaustively measures every text-region/OCR-observation pair for three public synthetic fixtures.
- excluded: association or best-match selection, OCR correctness, layout or subject semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, WPF/workflow/gateway/readiness integration, real exam/teacher/student data, cloud egress, live acceptance, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualSpatialObservationRequest` is strictly separate from answer generation and delivery contracts. It binds one committed VISION-008 result, the same-case committed VISION-009 result, and their identical canonical 2x crop authority.
- `VisualSpatialObservationResult` contains refs, OCR axis-aligned bounds, intersection area, coverage ratios for both rectangles, centroid distance squared, and one geometry-only relation for each Cartesian-product pair.
- relation values are `equal_bounds`, `observation_contains_region`, `region_contains_observation`, `overlap`, and `disjoint`. Touching edges have zero intersection and are `disjoint`.
- the frozen policy converts OCR quads with axis-aligned min/max bounds, treats rectangles as half-open, orders by candidate ID then observation ID, rounds coordinates to 6 places and ratios to 8 places, and emits stable JSON. No threshold or best-match rule exists.
- observed OCR text is not copied into spatial results. A relation is not renamed or interpreted as a label, question number, axis, tick, wire, component, subject concept, or correctness signal.
- dispositions are schema-fixed to `measurementStatus=completed`, `associationDisposition=not_decided`, `layoutDisposition=not_inferred`, `semanticDisposition=not_inferred`, `trackDisposition=not_integrated`, and `requiresHumanReview=true`.
- provenance is schema-fixed to `engineKind=deterministic_geometry`, `liveProvider=false`, and `cloudEgress=false`; the admitted interpreter identity is CPython `3.13.7`.
- the committed `VisualSpatialObservationCaseInventory` is the only runtime admission authority. Runtime requests must be canonical committed request files, and outputs must be new directories outside the repository.

## Authority and TOCTOU guards

- the runtime binds request inventory SHA-256, compiled `sourceRequestSha256`, and the request raw bytes reread after compilation. Any three-way mismatch fails closed.
- before invoking the VISION-008 and VISION-009 validators, the runtime captures raw-byte snapshots of both committed upstream inventories; it verifies those bytes again after validation and after all results are consumed.
- every reloaded structure/OCR result is bound back to its inventory snapshot by case ID, subject pack, canonical artifact ref, and raw-byte SHA-256.
- crop refs, raw-byte hashes, decoded RGB pixel hashes, scale, and dimensions must agree across both upstream results and the spatial request. Invalid, non-finite, negative, degenerate, or crop-external bounds fail closed.

## Synthetic measurements

| Subject pack | Case | Regions | OCR observations | Pairs | Relation summary | Expected result SHA-256 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `math-answer` | `math-function-graph` | 1 | 0 | 0 | no measurements | `35ba057661dc08abd268dedf3da22cbb8cde4f5f612f642cac43389e35bdc260` |
| `junior-physics-answer` | `junior-instrument-scale` | 1 | 1 | 1 | `disjoint=1` | `3cd9b6bca2dcd8a4547a30b2b2134640fca60ee2579c023ce4a8fa31082b3c3d` |
| `senior-physics-answer` | `senior-circuit-label` | 23 | 0 | 0 | no measurements | `7f69bcf391243f45081a7d2e93242e9e960ea911f6b262e78569528806c5bb92` |

The junior measurement binds `text-region-001` to `ocr-observation-001`; its OCR bounds are `x=49`, `y=103`, `width=223`, `height=62`, intersection area and both coverage ratios are `0`, and centroid distance squared is `31704.25`. Its `disjoint` relation is only a geometry diagnostic. It is not an OCR/region mismatch, a failed association, or evidence about association correctness.

Zero measurements are valid completed results whenever either input collection is empty. They are not runtime failures and do not prove that an image has no text or regions. All inputs remain public synthetic drawings inherited from VISION-007; no real paper, teacher, or student content was added or processed.

Three independent process replays produced byte-identical junior results with SHA-256 `3cd9b6bca2dcd8a4547a30b2b2134640fca60ee2579c023ce4a8fa31082b3c3d`.

## Review and focused verification

| Check | Result |
| --- | --- |
| observer tests | 15 total; 14 passed, 1 symlink capability skip |
| canonical fixture replay | 3 fixtures validated |
| independent process replay | 3/3 byte-identical |
| asset validation | 119 assets, 3 subject packs, 3 snapshots |
| cross-subject contract | passed with `snapshot-fb15fdf69827ecf1` |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required, 2 Advisory |

Focused fail-closed coverage includes geometry relations and touching edges, ordering/rounding, invalid and crop-external bounds, policy/cloud/interpreter drift, request byte drift during compilation, upstream inventory drift, reloaded-result/inventory mismatch, upstream/crop hash drift, computed-field drift, unlisted nested authority, hardlink alias, noncanonical request copy, repository output, and deterministic replay.

The two nonblocking review advisories remain explicit residual risks: the complete `R * O` Cartesian product is materialized in memory, which is acceptable only while the canonical authority remains the three fixed small synthetic fixtures; and the request symlink alias test requires a Windows/CI runner with symlink privilege.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` on 2026-07-28. Build/test used repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 119 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 390 seconds; `Toolchain check complete` |

Hotspot details:

- gateway `.env.example` validation passed with cloud egress disabled and missing example secrets explicitly allowed; synthetic vision request/failover contracts passed 6/6. A separate local `.env` config validation also passed with cloud egress disabled. No live request ran and `.env` was not modified or committed.
- VISION-007 preprocessing, VISION-008 extraction, VISION-009 OCR observation, and VISION-010 spatial observation tests and all three canonical fixture validators passed. VISION-010 reported 14 passes plus the one capability skip.
- visual evidence, visual risk, delivery aggregate, review queue, sample flywheel, synthetic answer generator, cross-subject snapshots, Chromium renderer smoke, subject eval sets, and OCR imports completed successfully.
- an initial hotspot invocation was terminated by the command runner's 1-second timeout while executing gateway validation. Standalone gateway validation passed, and the unchanged full hotspot was rerun with a 15-minute execution window to exit 0; the interrupted invocation is not counted as gate evidence.

## N/A records

### Spatial request symlink alias test

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314`, so the dedicated request-path alias test could not create its fixture.
- alternative_verification: production admission compares lexical absolute and resolved canonical paths; authority traversal rejects symlink/junction entries; hardlink physical-identity, canonical-request, nested-authority, and inventory coverage tests executed and passed; independent review found no authority bypass.
- evidence_link: this document, focused test `test_runtime_rejects_request_path_alias`, independent review, and final hotspot output.
- expires_at: next run on a host/session with symlink privilege, or when request-path admission changes, whichever occurs first.
- recovery_condition: execute the same focused suite with symlink capability and require the alias test to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and is not part of the default product gate; VISION-010 does not change its code, schema, or runtime.
- alternative_verification: assets, VISION-007 preprocessing, VISION-008 extraction, VISION-009 OCR observation, VISION-010 spatial observation, visual evidence, renderer, and subject eval gates execute in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback commits in reverse dependency order: upstream authority snapshot fix (`1be7eb1`), request snapshot fix (`f44a259`), runtime/contracts/fixtures/gates (`ad024f0`), and strategy (`da8b53a`). Delete only VISION-010 schemas, tool, fixtures, validator/hotspot wiring, strategy increments, and this evidence.
- do not modify VISION-007/008/009 authorities, `.env`, `tools/ocr/.venv`, gateway config, readiness receipts, sample flywheel authorities, or generated sample authorities during rollback.
- Cartesian materialization remains `O(R*O)`. A future authority-expansion slice must define admitted count or total-pair limits before accepting noncanonical or larger fixture sets.
- geometry measurements remain diagnostic observations. Association, layout, semantics, OCR correctness, and Track evidence require separate admitted contracts and review policies.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity; strategy truth, provider-neutral schemas, deterministic runtime, three synthetic fixture chains, independent review, focused checks, and full fixed-order gates are complete.
- `gateway verified`: unchanged; config plus synthetic request/failover/vision contracts only. No live provider or cloud call ran.
- `workflow integrated`: no. The observer is a standalone repository tool and is not connected to WPF, default answer generation, FigureUnderstanding, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: admitted association policy, OCR ground-truth/correctness acceptance, layout and subject semantics, OCR/image conflict policy, automatic FigureUnderstanding, Track B, Track C validator, default Track A integration, controlled real-data acceptance, WPF/workflow integration, bounded large-authority geometry, attested controls, live gateway verification, and workstation/live acceptance.
