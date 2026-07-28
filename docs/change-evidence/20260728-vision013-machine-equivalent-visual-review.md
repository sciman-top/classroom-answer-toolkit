# VISION-013 Machine-equivalent Synthetic Visual Review Evidence

## Goal and boundary

- landing point: VISION-007 through VISION-012 could prove frozen synthetic bytes, pixels, geometry, OCR observations, and diagnostic replay, but had no explicit observer record that the three canonical scale=2 crops were visibly coherent.
- target: record current AI visual inspection as hash-bound receipts and independently count machine-reviewed outcomes by subject pack. The review is equivalent to a human visual check only inside `synthetic_fixture_diagnostic`.
- identity boundary: every receipt records `reviewerKind=ai_agent`, `humanReviewed=false`, and `attestationClass=unattested_local_machine_review`. No artifact claims a human identity or writes `humanApproved`.
- excluded: real exam data, production visual truth, delivery trust, WPF/workflow integration, readiness authority, live gateway/provider acceptance, cloud egress, and `OptimizationCandidate` generation.

## Rejected precursor probe

Before implementation, a risk-first local RapidOCR probe tested whether region-scoped recognition added useful evidence for the visible `y`, `A`, and `R` labels. Standard detection/recognition remained empty after padding and 4x enlargement. Forced recognition-only returned low-confidence or empty output (`y -> "жа"`, confidence `0.0265`; `A -> "Вњ"`, confidence `0.4166`; `R -> ""`). The direction was rejected before schema or fixture work because it did not provide defensible incremental truth. No result from this probe was admitted as OCR quality, generated history, or visual acceptance.

## Implemented authority

- `VisualMachineReviewReceipt` binds one VISION-007 preprocessing result and canonical scale=2 crop by raw-byte SHA-256, decoded RGB pixel SHA-256, and pixel dimensions.
- the review declaration separately pins the exact preprocessing and crop authority actually observed. Both materialization and canonical validation call the same `validate_reviewed_authority` guard, so a coherent rewrite of crop, preprocessing, receipt, inventory, and report cannot re-sign old visual judgment.
- accept and reject are both reachable runtime decisions. An accepted review cannot contain `fail`; a rejected review must contain at least one `fail`.
- the local compiler verifies the admitted CPython `3.13.7` interpreter, captures upstream/local snapshots, recompiles subject and total metrics, validates staged bytes, and promotes report-only output only outside the repository.
- schema and semantic guards reject human identity, production equivalence/scope, live provider, cloud egress, delivery trust, WPF integration, live acceptance, verified controls, eligibility, and non-empty optimization candidate references.

## Visual observations

| Subject pack | Case | Observation | Disclosed limitation | Decision |
| --- | --- | --- | --- | --- |
| `math-answer` | `math-function-graph` | plotted line, axes, ticks, and visible `y` label are coherent | source-declared `x` label lies outside the admitted crop | `accept_for_diagnostic_use` |
| `junior-physics-answer` | `junior-instrument-scale` | scale frame, ticks, and red indicator are coherent | header is partially clipped | `accept_for_diagnostic_use` |
| `senior-physics-answer` | `senior-circuit-label` | circuit geometry and `A`/`R` labels are coherent | `synthetic circuit` header is partially clipped | `accept_for_diagnostic_use` |

All three canonical PNGs were inspected through direct image rendering. The senior circuit crop was additionally opened in Honeyview 5.51 through Computer Use; the visible circuit and `A`/`R` labels matched the receipt while the partial header clipping remained visible. These observations are AI review evidence, not a human signature.

Canonical totals are `reviewedCaseCount=3`, `acceptedCaseCount=3`, `rejectedCaseCount=0`, `limitedCaseCount=3`, `machineReviewedCount=3`, and `humanReviewedCount=0`.

## Canonical hashes

| Artifact | Raw-byte SHA-256 |
| --- | --- |
| case inventory | `0a01a4eca0c69ec7421a77a682782aa0c63e9413e85647ace4f20990c783cf03` |
| report | `c087baa1852793fbf96bd2725fd8c1a1535cf13a27514126b3d9f60df4c7fa24` |
| math receipt | `52587ab4a455567fb6f0d6051439bf82cb4f34ac87fdd7d3f0590017a9ed8590` |
| junior receipt | `d80773d178317ce2493a1cef0a787f92b5b7233859c86cb8e1899fdf0ac7b058` |
| senior receipt | `54175da41aade93bb9200b469c4837dc5cac4927874b00e9a3d13242b55a8151` |

## Review and focused verification

| Check | Result |
| --- | --- |
| machine review tests | 19/19 passed; no VISION-013 skip |
| canonical fixture replay | 3/3 fixtures validated |
| Python compilation | `py_compile` passed |
| asset validation | 131 assets, 3 subject packs, 3 snapshots |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required, 0 Optional, 0 Nit |

The first review found three Required issues: deterministic re-signing of changed crops, an unreachable reject branch, and unverified interpreter provenance. Commit `ffe5e8a` pinned observed authorities, made reject semantics reachable, and added runtime identity verification. The second review proved canonical validation could still accept a fully coherent manual authority rewrite; commit `09720b6` moved reviewed-authority validation into the canonical compile path and added a real one-pixel coherent rewrite regression. The third review independently replayed both attacks, reject/accept invariants, interpreter drift, and 11 privilege-escalation mutations, then approved the slice.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` on 2026-07-28. Build/test used the prepared local .NET SDK `10.0.301` first on `PATH`; bootstrap was not run.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 131 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 552.5 seconds; VISION-013 19/19 and 3/3 canonical fixtures passed |

Additional `npm --prefix tools/ai-gateway run validate:config` exited 0 against the local untracked configuration. It reported configured primary/fallback entries and `cloud egress: disabled`; secrets were not printed or recorded, `.env` was not modified or committed, and no live provider request ran. The hotspot separately validated `.env.example` with missing secrets allowed and ran six synthetic gateway request/failover contract tests.

## N/A records

### Existing visual symlink alias probes

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314` in existing visual path-alias tests; VISION-013 adds no symlink-dependent positive behavior.
- alternative_verification: canonical traversal rejects symlink/junction entries; hardlink physical-identity, copied-root, nested-authority, path escape, byte-snapshot, mid-run drift, and coherent one-pixel authority rewrite tests executed and passed.
- evidence_link: this document, final hotspot output, and VISION-007 through VISION-012 evidence records.
- expires_at: next run on a host/session with symlink privilege, or when canonical path admission changes, whichever occurs first.
- recovery_condition: run the unchanged focused suites with symlink capability and require every alias probe to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and outside the default product gate; VISION-013 does not change its code, schema, or runtime.
- alternative_verification: assets, visual preprocessing/observation/diagnostics/review, visual evidence, renderer, subject eval, sample flywheel, and OCR import gates all executed in the fixed hotspot.
- evidence_link: this document and final hotspot line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate order.

## Rollback and residual risk

- rollback VISION-013 in reverse dependency order: the commit containing this evidence, authority rewrite guard `09720b6`, initial review fixes `ffe5e8a`, gate wiring `4f33dd8`, runtime/contracts/fixtures `7a94740`, schemas `33a00cc`, and strategy `c6ab745`.
- preserve VISION-007 through VISION-012 authorities, `.env`, OCR environments, gateway config, delivery/review authorities, readiness receipt, sample flywheel, generated candidates, and teacher feedback authorities during rollback.
- machine review remains limited to three frozen public synthetic crops. Real exam visual quality, production truth governance, workflow integration, attested controls, and live acceptance require separate admitted contracts.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity. Strategy truth, schemas, review declarations, canonical receipts/report, deterministic validator/compiler, review closure, and fixed gates are complete.
- `gateway verified`: config plus synthetic request/failover contracts only. No live gateway/provider verification occurred.
- `workflow integrated`: no. The machine review tool is standalone and is not connected to WPF, answer generation, delivery trust, review lifecycle, or readiness.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: production/admitted visual review governance, real-data visual acceptance, WPF/workflow integration, delivery trust projection, attested controls, live gateway verification, and workstation/live acceptance.
