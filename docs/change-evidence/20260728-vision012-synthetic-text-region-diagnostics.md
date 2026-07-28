# VISION-012 Generator-declared Synthetic Text-region Diagnostic Evidence

## Goal and boundary

- landing point: VISION-008 provides deterministic heuristic `textRegionCandidates`, and VISION-011 provides generator-declared synthetic text/bbox truth, but the repository had no provider-neutral diagnostic of proposal coverage between those two authorities.
- target: establish a deterministic, hash-bound, subject-isolated diagnostic for positive-area text-region proposal coverage on the same three frozen public synthetic fixtures.
- excluded: human-authored truth, real exam/teacher/student data, text recognition, OCR-region association, layout or subject semantics, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, WPF/workflow/readiness integration, cloud egress, live acceptance, and `OptimizationCandidate` generation.

## Implemented contract

- `VisualTextRegionDiagnosticCaseInventory` binds each case to one VISION-008 structure result and one VISION-011 generator-declared synthetic truth by subject pack, canonical artifact ref, and raw-byte SHA-256.
- `VisualTextRegionDiagnosticReport` is a diagnostic-only result. It does not copy generator truth text, create recognized text, or infer OCR, association, layout, semantics, or Track state.
- coordinate space is `crop_pixel`; rectangles are half-open and require positive-area overlap. Edge-only contact does not match.
- only `fully_visible` truth enters the recall denominator. A candidate overlapping only `partially_clipped` truth is `unscored`; `outside_crop` truth does not shield a candidate from false-positive accounting.
- candidate-to-multiple-fully-visible-truth and fully-visible-truth-to-multiple-candidate ambiguity both fail closed.
- precision and recall use `{ available, value? }`; zero denominators are unavailable rather than assigned an invented numeric value.
- dispositions remain `acceptanceDisposition=not_accepted`, `requiresHumanReview=true`, `ocrDisposition=not_inferred`, `associationDisposition=not_decided`, `layoutDisposition=not_inferred`, `semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
- engine provenance is fixed to a deterministic local diagnostic with `liveProvider=false` and `cloudEgress=false`.

## Authority and fail-closed guards

- the two upstream inventories, three VISION-008 structure results, three VISION-011 truth files, diagnostic inventory, and diagnostic report form an eight-upstream-snapshot plus two-local-authority chain.
- all upstream artifacts are re-read and bound by raw-byte SHA-256. Structure and truth must agree on case, subject pack, `synthetic_fixture`, crop artifact ref, scale, source raw-byte hash, decoded RGB pixel hash, and crop pixel dimensions.
- public runtime accepts only the canonical diagnostic root. Runtime output must be a new directory outside the repository and is promoted only after staged bytes, diagnostic structure, and every captured upstream/local snapshot are revalidated.
- structure checks reject missing, extra, nested, symlink/junction, and physical-identity aliases. Path escape, repository output, direct alias, and hardlink alias cases fail closed.
- focused tests directly cover mid-run diagnostic inventory/report drift, VISION-008 result byte drift, VISION-011 truth byte drift, cross-crop mismatch, case mismatch, staged-report tamper, computed-field drift, ambiguous overlap, outside bounds, edge-touch, zero denominators, and deterministic replay.

## Synthetic diagnostic results

| Subject pack | Case | Scorable truth | Detected | False negatives | Candidates | Matched | Unscored | False positives | Precision | Recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `math-answer` | `math-function-graph` | 1 | 1 | 0 | 1 | 1 | 0 | 0 | `1` | `1` |
| `junior-physics-answer` | `junior-instrument-scale` | 0 | 0 | 0 | 1 | 0 | 1 | 0 | unavailable | unavailable |
| `senior-physics-answer` | `senior-circuit-label` | 2 | 2 | 0 | 23 | 2 | 21 | 0 | `1` | `1` |
| total | 3 cases | 3 | 3 | 0 | 25 | 3 | 22 | 0 | `1` | `1` |

- math truth `truth-label-002` and `text-region-001` intersect over 160 pixels: truth coverage `0.83333333`, candidate coverage `1`.
- senior truth labels `truth-label-001` and `truth-label-002` uniquely match `text-region-022` and `text-region-023`. Their truth coverage is `0.85714286` and `0.71428571`; candidate coverage is `1` for both.
- the junior candidate and the other 21 senior candidates overlap only partially clipped generator truth and are therefore unscored under the fixed policy.
- aggregate `precision=1` and `recall=1` describe only proposal coverage on these three frozen synthetic fixtures. They are not production text-region precision/recall, OCR quality, real-paper evidence, or acceptance.

The canonical inventory raw-byte SHA-256 is `3bcedefc65b1c26cbc1bc600a75ff1e95537f946168c29d7a38e1b438768eac5`. The canonical report raw-byte SHA-256 is `7c21c2ff04ecde95387ce2a7c5a45c928eaf15d7ecee70ecdb7b9f12ae0ba488`. A baseline plus three independent-process materializations produced identical bytes and no worktree drift.

## Review and focused verification

| Check | Result |
| --- | --- |
| diagnostic tests | 21/21 passed; no VISION-012 skip |
| canonical fixture replay | 3/3 fixtures validated |
| independent process replay | baseline plus 3/3 byte-identical materializations |
| asset validation | 126 assets, 3 subject packs, 3 snapshots |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required, 0 Advisory, 0 Nit |

The first independent review approved the implementation with two advisories: add direct regressions for upstream result/truth byte drift and crop/case mismatch, and avoid repeatedly loading upstream authority in pure geometry tests. Commit `fe65e6d` added copied-root fail-closed regressions and a class-level cache used only by four pure `compile_case_report` tests; runtime, canonical replay, snapshot, and cross-binding paths still load fresh authority. Final re-review found both advisories fully closed.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` on 2026-07-28. Build/test used the prepared local .NET SDK `10.0.301` first on `PATH`; bootstrap was not run.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 126 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 518.5 seconds; VISION-012 21/21 and 3/3 canonical fixtures passed |

Additional `npm --prefix tools/ai-gateway run validate:config` exited 0 against the local untracked configuration. Secrets were not printed or recorded, `cloud egress: disabled`, `.env` was not modified or committed, and no live provider request ran. The hotspot separately validated `.env.example` with missing secrets allowed and ran six synthetic gateway vision request/failover contract tests.

## N/A records

### Existing visual symlink alias probes

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314` in existing visual path-alias tests; VISION-012 adds no symlink-dependent positive behavior.
- alternative_verification: canonical traversal rejects symlink/junction entries; hardlink physical-identity, copied-root, nested-authority, path escape, exact coverage, byte-snapshot, and mid-run upstream drift tests executed and passed; independent review found no remaining authority bypass.
- evidence_link: this document, final hotspot output, and VISION-007 through VISION-011 evidence records.
- expires_at: next run on a host/session with symlink privilege, or when canonical path admission changes, whichever occurs first.
- recovery_condition: run the unchanged focused suites with symlink capability and require every alias probe to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and outside the default product gate; VISION-012 does not change its code, schema, or runtime.
- alternative_verification: assets, preprocessing, structure extraction, OCR observation, spatial observation, OCR/text-region diagnostics, visual evidence, renderer, subject eval, and OCR import gates all executed in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback VISION-012 in reverse dependency order: the commit containing this evidence, test hardening `fe65e6d`, gate wiring `765cc8f`, runtime/contracts/fixtures `0cbf777`, schema contracts `4f5eb8c`, and strategy `99bffcd`.
- preserve VISION-007/008/009/010/011 authorities, `.env`, OCR environments, gateway config, readiness receipt, sample flywheel, generated sample authorities, and teacher feedback authorities during rollback.
- generator-declared truth remains limited to frozen synthetic fixtures. Real proposal quality, human truth governance, OCR-region association, layout/semantic reasoning, and controlled real-data acceptance require separate admitted contracts.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity. Strategy truth, schemas, deterministic runtime, three synthetic diagnostic chains, review closure, and fixed gates are complete.
- `gateway verified`: config plus synthetic request/failover contracts only. No live gateway/provider verification occurred.
- `workflow integrated`: no. The diagnostic remains a standalone repository tool and is not connected to WPF, default answer generation, OCR-region association, FigureUnderstanding, Track A/B/C, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: human/admitted region truth governance, real text-region benchmark and acceptance, OCR-region association, layout and subject semantics, OCR/image conflict policy, automatic FigureUnderstanding, Track B, Track C validator, default Track A integration, controlled real-data acceptance, WPF/workflow integration, attested controls, live gateway verification, and workstation/live acceptance.
