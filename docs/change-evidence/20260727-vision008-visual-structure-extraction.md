# VISION-008 Visual Structure Extraction Evidence

## Goal and boundary

- landing point: VISION-007 provided hash-bound canonical 2x crops, but the repository had no admitted structure extraction contract or deterministic local candidate runtime.
- target: establish provider-neutral request/result/inventory contracts and deterministic nonsemantic line, connected-region, and text-region candidates for three public synthetic subject fixtures.
- excluded: OCR, recognized text, layout or subject semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, WPF/workflow/gateway/readiness integration, real exam/teacher/student data, cloud egress, live acceptance, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualStructureExtractionRequest` binds `synthetic_fixture/public`, the committed VISION-007 preprocessing result and canonical 2x crop, fixed extraction policy, and `allowCloud=false`.
- `VisualStructureExtractionResult` emits normalized `LineSegmentCandidate`, `ConnectedRegionCandidate`, and heuristic-only `TextRegionCandidate` records in `crop_pixel` coordinates. It contains no `recognizedText` field.
- result dispositions are fixed to `ocrDisposition=not_attempted`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
- result provenance is schema-bound to `engineKind=local_runtime`, `liveProvider=false`, and `cloudEgress=false`; asset validation includes negative mutations for remote, live, and cloud provenance.
- the committed `VisualStructureExtractionCaseInventory` is the only runtime admission authority. Runtime requests must be canonical committed request files and cannot supply an alternate inventory or copied fixture root.
- every compile first validates the complete VISION-007 authority, then binds the preprocessing result raw-byte SHA-256 and its single scale=2 crop raw-byte, decoded RGB pixel, and dimension fields.
- extraction uses threshold 200 binary-inverted, 8-connected components with minimum area 8, Canny 50/150 aperture 3, and HoughLinesP rho 1 / theta 1 degree / threshold 30 / minimum length 20 / maximum gap 4. Text-region candidates are only area-and-bounds heuristics.
- Hough endpoints are normalized, duplicate tuples removed, all candidates sorted deterministically, IDs regenerated from canonical order, and summary/computed fields revalidated against committed results.
- runtime output must be a new directory outside the repository and is staged in a sibling temporary directory before atomic rename.

## Synthetic fixtures

| Subject pack | Case | Lines | Connected regions | Text-region candidates |
| --- | --- | ---: | ---: | ---: |
| `math-answer` | `math-function-graph` | 34 | 2 | 1 |
| `junior-physics-answer` | `junior-instrument-scale` | 30 | 22 | 1 |
| `senior-physics-answer` | `senior-circuit-label` | 38 | 24 | 23 |

All inputs are the VISION-007 public synthetic drawings. No real paper, teacher, or student content was added or processed.

## Review and focused verification

| Check | Result |
| --- | --- |
| extractor tests | 12 total; 11 passed, 1 symlink capability skip |
| canonical fixture replay | 3 fixtures validated |
| independent-process replay | 5/5 validations passed; senior result SHA-256 remained `9b638be6a7ea0274ebe6fb0fbe36c0cec8222b4193d94fabbd498d31ffdea15c` |
| asset validation | 105 assets, 3 subject packs, 3 snapshots |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required |

The first independent review found one Required issue: the result schema allowed `remote_provider` and arbitrary `liveProvider/cloudEgress` booleans even though runtime output stayed local. Commit `9963572` fixed all three fields to local negative provenance and added three schema-only mutation regressions. The reviewer independently confirmed remote/live/cloud/OCR-positive forged results are rejected.

Focused fail-closed coverage executed for policy/cloud drift, preprocessing-result hash drift, scale=1 and crop binding drift, result computed-field drift, unlisted nested authority, hardlink alias, noncanonical request copy, repository output, and deterministic replay.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` with repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 105 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 311.2 seconds; `Toolchain check complete` |

Hotspot details:

- gateway `.env.example` validation passed with cloud egress disabled and missing example secrets explicitly allowed; synthetic vision contracts passed 6/6. No live request ran.
- DecisionRecord 14/14, visual-risk 12/12, VISION-007 preprocessing 12 pass + 1 capability skip, VISION-008 extraction 11 pass + 1 capability skip, delivery aggregate 59/59, and review queue 6/6.
- sample flywheel 72 pass + 1 symlink capability skip; synthetic answer generator 8/8.
- six subject/profile snapshots, cross-subject, Chromium renderer smoke, all three subject eval sets, and OCR imports passed.

## N/A records

### Structure extraction symlink/junction alias test

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314`, so the dedicated request-path alias test could not create its fixture.
- alternative_verification: production admission compares lexical absolute and resolved canonical paths; authority traversal rejects symlink/junction entries; the hardlink physical-identity alias test executed and passed; the independent reviewer found no path-authority bypass.
- evidence_link: this document, focused test `test_runtime_rejects_request_path_alias`, independent review, and final hotspot output.
- expires_at: next run on a host/session with symlink privilege, or when path admission changes, whichever occurs first.
- recovery_condition: execute the same focused suite with symlink capability and require the alias test to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and is not part of the default product gate; VISION-008 does not change its code, schema, or runtime.
- alternative_verification: assets, VISION-007 preprocessing, VISION-008 extraction, visual evidence, renderer, and subject eval gates execute in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback commits in reverse dependency order: provenance boundary fix (`9963572`), runtime/hotspot (`fb0cecd`), contracts/fixtures (`907100c`), and strategy (`4bf747c`). Delete only VISION-008 schemas, tool, fixtures, validator/hotspot wiring, strategy increments, and this evidence.
- do not modify VISION-007 PNG/preprocessing authority, `.env`, `tools/ocr/.venv`, gateway config, readiness receipts, or canonical sample authorities during rollback.
- OpenCV candidate bytes and provenance are intentionally component-version bound. A future OpenCV/Pillow change requires reviewed rematerialization and explicit output-drift evidence.
- text-region candidates are bounding-box heuristics, not OCR or classification. Their counts are fixture diagnostics, not quality or accuracy claims.

## Acceptance boundary

- `repo-side done`: pending evidence commit, push, and remote parity; contracts, fixtures, deterministic runtime, independent review, focused checks, and full fixed-order gates are complete.
- `gateway verified`: unchanged; `.env.example` config plus synthetic request/failover/vision contracts only. No live provider or cloud call ran.
- `workflow integrated`: no. The extractor is a standalone repository tool and is not connected to WPF, the default generation workflow, FigureUnderstanding, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: real OCR, recognized text, layout and subject semantics, automatic FigureUnderstanding, Track B, Track C validator, default Track A integration, controlled real-data acceptance, WPF/workflow integration, attested controls, live gateway verification, and workstation/live acceptance.
