# VISION-011 Generator-declared Synthetic OCR Diagnostic Evidence

## Goal and boundary

- landing point: VISION-007 provides three frozen public synthetic drawings and VISION-009 provides local OCR observations, but the repository had no admitted ground-truth authority or diagnostic metrics for those observations.
- target: establish generator-declared synthetic text truth, a deterministic provider-neutral diagnostic runtime, three subject-isolated fixture chains, and repository gates that report exact-text OCR observations without promoting them to acceptance evidence.
- excluded: human-authored truth, real exam/teacher/student data, OCR-region association, layout or subject semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, WPF/workflow/readiness integration, cloud egress, live acceptance, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualSyntheticTextTruth` is strictly generator-declared synthetic truth. It is derived from the VISION-007 renderer's single `TEXT_DECLARATIONS` authority and is not human annotation, historical production data, or a real OCR benchmark.
- visibility is fixed to `fully_visible`, `partially_clipped`, or `outside_crop`. Only `fully_visible` truth enters the recall denominator.
- a match requires exact case-sensitive UTF-8 text and positive-area intersection between the OCR quad's axis-aligned bounds and the truth crop bbox. Edge-only contact does not match.
- a partially clipped exact overlap is `unscored`; an outside-crop label does not shield an OCR observation. Repeated exact candidates and duplicate scorable truth fail closed.
- precision and recall use `{ available, value? }`; a zero denominator is represented as unavailable rather than an invented numeric value.
- reports contain observation references and metrics but do not copy `observedText`.
- dispositions are fixed to `diagnosticStatus=completed`, `diagnosticScope=generator_declared_synthetic_fixture`, `acceptanceDisposition=not_accepted`, `requiresHumanReview=true`, `layoutDisposition=not_inferred`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
- provenance is fixed to `engineKind=deterministic_diagnostic`, `liveProvider=false`, and `cloudEgress=false`, with admitted runtime CPython `3.13.7` and Pillow `12.3.0`.

## Authority and fail-closed guards

- the committed case inventory is the canonical admission authority. Inventory, three truth files, report, renderer, preprocessing/OCR inventories and results, source images, and 2x crops are captured as raw-byte snapshots and re-read before output promotion.
- canonical structure checks reject missing, extra, nested, symlink/junction, and physical-identity alias entries. Public runtime consumes only `CANONICAL_ROOT`; copied fixture roots are not an admitted runtime input.
- the staged external report is re-read byte-for-byte before atomic rename. Runtime output must be a new directory outside the repository.
- source and crop authorities retain raw-byte and decoded RGB pixel SHA-256 bindings. Generator text bounds must be nondegenerate and fully inside source pixel bounds; crop-relative bounds must remain inside the crop.
- the current renderer is replayed and its encoded PNG bytes must equal each committed source image. The declaration refactor preserved all VISION-007 source/crop PNG bytes and VISION-009 OCR fixture bytes.
- focused regressions cover inventory/truth/report mid-run mutation, staged-report tamper, mid-run structure drift, renderer-output drift, source external bounds, hardlink alias, nested authority, computed-field drift, and deterministic replay.

## Synthetic diagnostic results

| Subject pack | Case | Scorable truth | Detected | False negatives | OCR observations | False positives | Precision | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `math-answer` | `math-function-graph` | 1 | 0 | 1 | 0 | 0 | unavailable | `0` |
| `junior-physics-answer` | `junior-instrument-scale` | 0 | 0 | 0 | 1 | 1 | `0` | unavailable |
| `senior-physics-answer` | `senior-circuit-label` | 2 | 0 | 2 | 0 | 0 | unavailable | `0` |
| total | 3 cases | 3 | 0 | 3 | 1 | 1 | `0` | `0` |

The math case has one fully visible scorable label and one outside-crop label. The junior label is partially clipped, so it is excluded from recall while the unmatched observation remains a false positive. The senior case has two fully visible labels plus one partially clipped label. These misses and the junior false positive describe only the three frozen synthetic fixtures; they are not production OCR precision/recall, OCR acceptance, or evidence about real papers.

The canonical report raw-byte SHA-256 is `ce9996cc937c78b87811a6bdf41f5c2ef6f4d0b7bf468fceeeac2083f964cee7`. A baseline plus three independent process materializations produced the same hash and no authority drift. The current renderer source SHA-256 is `f8894adbe43accf66875033228ef87fd1107ebefba69f95008b8b50c16588ddb`.

## Review and focused verification

| Check | Result |
| --- | --- |
| diagnostic tests | 18/18 passed; no VISION-011 skip |
| canonical fixture replay | 3/3 fixtures validated |
| independent process replay | 3/3 byte-identical after baseline |
| asset validation | 124 assets, 3 subject packs, 3 snapshots |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required, 1 Advisory |

The first review found two Required issues: diagnostic inventory/truth TOCTOU exposure and missing source-pixel bounds validation. The first fix closed both and added renderer-to-source replay. Re-review then found runtime bypass of the canonical structure guard and a copied-root public seam. The second fix restored canonical-only public runtime admission, shared and repeated the structure guard before rename, and added staged-byte verification. Final independent review approved all fixes.

The one nonblocking advisory remains explicit: `visual_ocr_diagnostics.py` is approximately 970 lines and performs one redundant upstream snapshot read. A future natural maintenance slice should separate authority loading, matching, and output promotion and remove the duplicate read without weakening the current fail-closed sequence.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` on 2026-07-28. Build/test used repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 124 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 460.5 seconds; VISION-011 18/18 and 3/3 canonical fixtures passed |

Additional `npm --prefix tools/ai-gateway run validate:config` exited 0. Local configuration parsed with secrets present but not printed, and `cloud egress: disabled`; `.env` was not modified or committed. The hotspot's `.env.example` validation and six synthetic vision request/failover contract tests also passed. No live provider request ran.

## N/A records

### Existing visual symlink alias probes

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314` in existing VISION-007/008/009/010 path-alias tests; VISION-011 adds no symlink-dependent test.
- alternative_verification: canonical traversal rejects symlink/junction entries; hardlink physical-identity, copied-root, nested-authority, exact-coverage, mid-run structure, and byte-snapshot tests executed and passed; independent review found no remaining authority bypass.
- evidence_link: this document, final hotspot output, and the VISION-007 through VISION-010 evidence records.
- expires_at: next run on a host/session with symlink privilege, or when canonical path admission changes, whichever occurs first.
- recovery_condition: run the unchanged focused suites with symlink capability and require every alias probe to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and is outside the default product gate; VISION-011 does not change its code, schema, or runtime.
- alternative_verification: assets, preprocessing, structure extraction, OCR observation, spatial observation, OCR diagnostics, visual evidence, renderer, subject eval, and OCR import gates all executed in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback VISION-011 in reverse dependency order: evidence commit, authority hardening `0bd3ec4`, gate wiring `c00d0ca`, runtime/contracts/fixtures `15a2d1d`, renderer declaration refactor `ef2e828`, and strategy `4050c8d`.
- project-rule sync `8a5f6e6` is an independent governance commit; revert it separately only if GlobalUser v9.58/reference governance is rolled back.
- do not modify VISION-007/008/009/010 authorities, `.env`, OCR environments, readiness receipts, sample flywheel authorities, generated sample authorities, or gateway runtime during rollback.
- generator-declared truth remains limited to frozen synthetic fixtures. Real OCR quality, manual truth governance, association, layout, semantics, and controlled real-data acceptance require separate admitted contracts.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity. Strategy truth, schemas, renderer declarations, deterministic runtime, three synthetic truth/diagnostic chains, review closure, and fixed gates are complete.
- `gateway verified`: config plus synthetic request/failover contracts only. No live gateway/provider verification occurred.
- `workflow integrated`: no. The diagnostic remains a standalone repository tool and is not connected to WPF, default answer generation, FigureUnderstanding, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: human/admitted OCR truth governance, real OCR benchmark and acceptance, OCR-region association, layout and subject semantics, OCR/image conflict policy, automatic FigureUnderstanding, Track B, Track C validator, default Track A integration, controlled real-data acceptance, WPF/workflow integration, attested controls, live gateway verification, and workstation/live acceptance.
