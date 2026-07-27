# VISION-009 Local OCR Observation Evidence

## Goal and boundary

- landing point: VISION-007 provided hash-bound canonical 2x crops and VISION-008 provided same-case nonsemantic structure results, but the repository had no admitted OCR observation contract or deterministic local observation runtime.
- target: establish provider-neutral request/result/inventory contracts and preserve raw local RapidOCR observations for three public synthetic subject fixtures without asserting correctness.
- excluded: OCR ground truth, OCR correctness or acceptance, layout and subject semantics, OCR/image conflict, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, WPF/workflow/gateway/readiness integration, real exam/teacher/student data, cloud egress, live acceptance, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualOcrObservationRequest` binds `synthetic_fixture/public`, the committed VISION-007 preprocessing result and canonical 2x crop, the same-case committed VISION-008 structure result, a frozen runtime policy, and `allowCloud=false`.
- `VisualOcrObservationResult` preserves normalized raw quadrilateral, observed text, confidence, deterministic order/IDs, count, and observed-text hash. Empty observations are valid.
- dispositions are schema-fixed to `observationStatus=completed`, `groundTruthAvailable=false`, `acceptanceDisposition=not_evaluated`, `requiresHumanReview=true`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
- provenance is schema-fixed to `engineKind=local_runtime`, `liveProvider=false`, and `cloudEgress=false`.
- the committed `VisualOcrObservationCaseInventory` is the only runtime admission authority. Runtime requests must be canonical committed request files and cannot select an alternate inventory or copied fixture root.
- inference consumes the already raw-byte/pixel/dimension-verified crop bytes, avoiding a second path read between validation and inference.
- runtime identity binds CPython `3.13.7`, RapidOCR `1.2.3`, ONNX Runtime `1.27.0`, OpenCV `5.0.0`, Pillow `12.3.0`, NumPy `2.5.0`, PyYAML `6.0.3`, pyclipper `1.4.0`, Shapely `2.1.2`, six `1.17.0`, and CPU-only detector/classifier/recognizer sessions.
- the RapidOCR config and bundled detection/classification/recognition model bytes are checked against reviewed SHA-256 values before and after engine construction. Drift fails closed before inference.
- runtime output must be a new directory outside the repository and is staged in a sibling temporary directory before atomic rename.

## Synthetic observations

| Subject pack | Case | Observation count | Raw observed text | Expected result SHA-256 |
| --- | --- | ---: | --- | --- |
| `math-answer` | `math-function-graph` | 0 | none | `1d392af4c6080bb5222931bd714a14b610d455ab93946cc73d824b08aba7ab8e` |
| `junior-physics-answer` | `junior-instrument-scale` | 1 | `+++++++++` at confidence `0.6787174` | `e3244936d0350cea21d9b96618ea975dd7ba7eba507fb0493336c29f7ec20839` |
| `senior-physics-answer` | `senior-circuit-label` | 0 | none | `ea3458311113a609f831fbba66c85c5fa358728aafd51cb25957b9cf01aef674` |

`+++++++++` is an uncorrected diagnostic model observation. It is not a label, answer, ground truth, correctness result, accepted OCR output, semantic inference, or Track evidence. The two empty observation arrays are valid completed observations, not failures and not evidence that the images contain no text.

All inputs are public synthetic drawings inherited from VISION-007. No real paper, teacher, or student content was added or processed.

## Review and focused verification

| Check | Result |
| --- | --- |
| observer tests | 20 total; 19 passed, 1 symlink capability skip |
| canonical fixture replay | 3 fixtures validated |
| dependency health | `pip check`: no broken requirements |
| asset validation | 112 assets, 3 subject packs, 3 snapshots |
| cross-subject contract | passed with `snapshot-fb15fdf69827ecf1` |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required, 3 Advisory |

The independent review initially found Required issues in crop TOCTOU handling, behavior-relevant transitive dependency identity, interpreter reproducibility, bootstrap launcher selection, and config/model TOCTOU handling. Commit `7565957` closed them with byte-input inference, exact interpreter/component policy and schema provenance, pinned requirements, an exact-version bootstrap guard, pre/post engine-construction artifact checks, and regression tests.

Focused fail-closed coverage includes runtime/package/interpreter/component/model/config/provider drift, drift during engine construction, verified-bytes inference, policy/cloud drift, preprocessing/structure/crop binding drift, result computed-field drift, unlisted nested authority, hardlink alias, noncanonical request copy, repository output, normalization, and deterministic replay.

The three nonblocking review advisories remain explicit residual risks: requirements do not yet use wheel hashes and bootstrap packaging tools are not pinned; pre/post artifact hashing does not defend against a privileged instantaneous swap-and-restore attacker; the request symlink test requires a privileged Windows/CI runner.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` on 2026-07-27. Build/test used repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 112 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 444.7 seconds; `Toolchain check complete` |

Hotspot details:

- gateway `.env.example` config validation passed with cloud egress disabled and missing example secrets explicitly allowed; synthetic vision contracts passed 6/6. No live request ran.
- VISION-007 preprocessing passed 12 plus 1 capability skip; VISION-008 extraction passed 11 plus 1 capability skip; VISION-009 observation passed 19 plus 1 capability skip and validated all 3 fixtures.
- DecisionRecord 14/14, visual-risk 12/12, delivery aggregate 59/59, review queue 6/6, sample flywheel 72 plus 1 capability skip, and synthetic answer generator 8/8 passed.
- six subject/profile snapshots, cross-subject validation, Chromium renderer smoke, all three subject eval sets, and OCR imports passed.

## N/A records

### OCR request symlink/junction alias test

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314`, so the dedicated request-path alias test could not create its fixture.
- alternative_verification: production admission compares lexical absolute and resolved canonical paths; authority traversal rejects symlink/junction entries; the hardlink physical-identity alias test executed and passed; independent review found no path-authority bypass.
- evidence_link: this document, focused test `test_runtime_rejects_request_path_alias`, independent review, and final hotspot output.
- expires_at: next run on a host/session with symlink privilege, or when path admission changes, whichever occurs first.
- recovery_condition: execute the same focused suite with symlink capability and require the alias test to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and is not part of the default product gate; VISION-009 does not change its code, schema, or runtime.
- alternative_verification: assets, VISION-007 preprocessing, VISION-008 extraction, VISION-009 OCR observation, visual evidence, renderer, and subject eval gates execute in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback commits in reverse dependency order: review fixes (`7565957`), repository gates (`e5650b0`), runtime/fixtures (`ae840b5`), runtime identity (`1cc1a35`), contracts (`212a867`), and strategy (`55fc695`, `816bafc`, `2f53238`). Delete only VISION-009 schemas, tool, fixtures, validator/hotspot wiring, strategy increments, and this evidence.
- do not modify VISION-007/008 authorities, `.env`, `tools/ocr/.venv`, gateway config, readiness receipts, sample flywheel authorities, or canonical generated samples during rollback.
- runtime reproducibility currently trusts local OCR venv write permissions and package index resolution. A future supply-chain slice may add a wheel-hashed lock and pinned packaging tools.
- OCR outputs remain model observations. No accuracy, recall, conflict, correctness, or acceptance metric can be inferred without separately admitted ground truth and review policy.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity; contracts, three synthetic fixture chains, deterministic local runtime, independent review, focused checks, and full fixed-order gates are complete.
- `gateway verified`: unchanged; `.env.example` config plus synthetic request/failover/vision contracts only. No live provider or cloud call ran.
- `workflow integrated`: no. The observer is a standalone repository tool and is not connected to WPF, the default answer-generation workflow, FigureUnderstanding, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: OCR ground-truth/correctness acceptance, layout and subject semantics, OCR/image conflict policy, automatic FigureUnderstanding, Track B, Track C validator, default Track A integration, controlled real-data acceptance, WPF/workflow integration, hashed Python dependency lock, attested controls, live gateway verification, and workstation/live acceptance.
