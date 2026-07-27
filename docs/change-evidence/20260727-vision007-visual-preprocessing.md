# VISION-007 Visual Preprocessing Evidence

## Goal and boundary

- landing point: `NormalizedPage / VisualRegion` and visual decision contracts existed, but the repository had no hash-bound local image crop runtime.
- target: establish provider-neutral preprocessing request/result/inventory contracts and deterministic 1x/2x local crops for three public synthetic subject fixtures.
- excluded: OCR/layout semantics, automatic region detection, deskew/denoise inference, Track A/B/C solving, WPF, gateway calls, trust/approval, readiness/optimizer changes, real exam/teacher/student data, cloud egress, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualPreprocessingRequest` binds `synthetic_fixture/public`, canonical source raw-byte SHA-256, decoded RGB pixel SHA-256, integer `page_pixel` bbox, exact scales `[1,2]`, and `allowCloud=false`.
- `VisualPreprocessingResult` carries one `NormalizedPage`, one `VisualRegion`, source/request bindings, 1x/2x crop raw-byte and decoded-pixel hashes, dimensions, interpolation, and provider-neutral engine/component provenance.
- the committed `VisualPreprocessingCaseInventory` is the only runtime admission authority. The CLI cannot supply an alternate inventory or re-sign a copied fixture root.
- 1x preserves source pixels; 2x uses fixed OpenCV `INTER_NEAREST`. Pillow performs RGB decode/PNG encode. Verified environment: OpenCV `5.0.0`, Pillow `12.3.0`.
- runtime output must be a new directory outside the repository. The complete bundle is staged in a sibling temporary directory and renamed into place only after all bytes are ready.
- canonical validation rejects path escape, noncanonical request alias, physical hardlink alias, unknown/nested/symlink authority, raw-byte or pixel hash drift, bbox/scale/dimension/interpolation/provenance/computed-field drift, non-public/non-synthetic input, and cloud egress.

## Synthetic fixtures

| Subject pack | Case | Source | Crop |
| --- | --- | --- | --- |
| `math-answer` | coordinate/function graph | `math-function-graph.source.png` | 1x + 2x |
| `junior-physics-answer` | instrument scale | `junior-instrument-scale.source.png` | 1x + 2x |
| `senior-physics-answer` | circuit/experiment label | `senior-circuit-label.source.png` | 1x + 2x |

All three source PNGs and their crops were visually inspected as nonblank, correctly framed synthetic drawings. They contain no real paper, teacher, or student content.

## Review and focused verification

| Check | Result |
| --- | --- |
| visual preprocessor tests | 13 total; 12 passed, 1 symlink capability skip |
| canonical fixture replay | 3 fixtures validated |
| asset validation | 98 assets, 3 subject packs, 3 snapshots |
| cross-subject contract | passed with `snapshot-fb15fdf69827ecf1` |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required |

The first independent review found one Required issue: runtime accepted a caller-selected, internally self-consistent inventory, allowing a copied fixture set to self-sign new authority. Commit `669230d` removed `--inventory`, fixed runtime admission to the committed inventory/root, rejected noncanonical request paths, and added regression coverage. Local self-review also added recursive exact-coverage rejection in `fcf9742`.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` with repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 98 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 283.1 seconds; `Toolchain check complete` |

Hotspot details:

- gateway `.env.example` config validation passed with cloud egress disabled and missing example secrets explicitly allowed; synthetic vision contracts passed 6/6. No live request ran.
- DecisionRecord 14/14, visual-risk 12/12, visual preprocessing 12 pass + 1 capability skip, delivery aggregate 59/59, review queue 6/6.
- sample flywheel 72 pass + 1 symlink capability skip; synthetic answer generator 8/8.
- six subject/profile snapshots, cross-subject, Chromium renderer smoke, all three subject eval sets, and OCR imports passed.

## N/A records

### Visual preprocessing symlink/junction alias test

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314`, so the dedicated request-path alias test could not create its fixture.
- alternative_verification: production code compares lexical absolute and resolved canonical paths before admission; the hardlink physical-identity alias test executed and passed; existing sample-flywheel junction tests in the same hotspot also passed.
- evidence_link: this document, focused test `test_runtime_rejects_request_path_alias`, and final hotspot output.
- expires_at: next run on a host/session with symlink privilege, or when the path-admission implementation changes, whichever occurs first.
- recovery_condition: execute the same focused suite with symlink capability and require the alias test to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and is not part of the default product gate; VISION-007 does not change its code, schema, or runtime.
- alternative_verification: assets, visual preprocessing, visual evidence, renderer, and subject eval gates all executed in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback commits in reverse dependency order: runtime/review fixes (`669230d`, `fcf9742`, `b4c4ac9`), contract/fixtures (`5bcc4aa`), and strategy (`f06f61a`). Do not modify `.env`, `tools/ocr/.venv`, gateway config, existing visual authorities, readiness receipts, or sample flywheel assets.
- PNG bytes and provenance are intentionally component-version bound. A future Pillow/OpenCV change must rematerialize only after review and explain dependency/output drift.
- explicit bbox input is trusted only as admitted canonical fixture data. This slice does not infer regions or measure OCR/layout/model accuracy.

## Acceptance boundary

- `repo-side done`: yes for VISION-007 contracts, three synthetic fixture bundles, deterministic local runtime, independent review, focused tests, full fixed-order gates, evidence, and rollback definition. Commit/push parity is recorded after closeout.
- `gateway verified`: `.env.example` config plus synthetic request/failover/vision contracts only; no live provider or cloud call.
- `workflow integrated`: no. The preprocessor is a standalone repository tool and is not connected to WPF, default original-question generation, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: OCR/layout/element extraction, automatic region detection, Track B, Track C validator, default Track A integration, real controlled-data acceptance, WPF/workflow integration, approval/lifecycle, Typst adapter/parity, attested controls, live gateway verification, and workstation/live acceptance.
