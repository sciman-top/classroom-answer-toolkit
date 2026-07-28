# VISION-014 OCR-region Association Diagnostic Evidence

## Goal and boundary

- landing point: VISION-008 provided text-region candidates, VISION-009 provided OCR observations,
  and VISION-010 provided exhaustive geometry, but the repository had no deterministic policy for
  diagnosing which observations could be associated with which candidates.
- target: add a provider-neutral, hash-bound, fail-closed association diagnostic over the three
  frozen public synthetic fixtures and land the verified slice on `D:\CODE\classroom-answer-toolkit`
  `main`.
- authority boundary: association is diagnostic policy output. It is not recognized-text truth,
  OCR correctness, layout or subject semantics, Track B evidence, or visual acceptance.
- excluded: real exam, teacher, or student data; live providers; cloud egress; delivery trust;
  WPF/default answer workflow integration; readiness attestation; and `OptimizationCandidate`.

## Risk-first finding

A read-only probe of the committed VISION-008, VISION-009, and VISION-010 authorities proved that
the current frozen fixtures cannot honestly support a positive canonical association:

| Subject pack | Case | Candidate / observation state | Canonical outcome |
| --- | --- | --- | --- |
| `math-answer` | `math-function-graph` | 1 candidate, 0 observations | `unavailable` |
| `junior-physics-answer` | `junior-instrument-scale` | 1 candidate, 1 observation; the only measurement is `disjoint` with zero intersection | `unmatched` |
| `senior-physics-answer` | `senior-circuit-label` | 23 candidates, 0 observations | `unavailable` |

The canonical totals are therefore `matched=0`, `unmatched=1`, `ambiguous=0`, and
`unavailable=2`. A positive association and an ambiguity are covered only by isolated policy unit
inputs. They are not canonical fixtures, generated or historical samples, human labels, OCR truth,
or acceptance evidence.

## Implemented authority

- four schemas define request, result, case-inventory, and report contracts;
- the request binds same-case VISION-008, VISION-009, and VISION-010 results by canonical ref and
  raw-byte SHA-256, plus the shared scale-2 crop authority and frozen policy;
- an eligible edge requires positive `intersectionArea` and a non-`disjoint` relation; both the
  candidate and observation endpoints must have exactly one eligible edge;
- any one-to-many or many-to-one eligible graph fails closed; distance, OCR confidence,
  `observedText`, and generator-declared truth are never used to guess a match;
- empty endpoints produce `unavailable`; non-empty endpoints with no eligible edge produce
  `unmatched`; zero-denominator ratios use `{ "available": false }`;
- the runtime enforces canonical containment and physical identity, upstream and crop byte/pixel/
  dimension authority, complete Cartesian measurements, raw-byte hashes, snapshot/TOCTOU guards,
  staged-output validation, and atomic report-only promotion outside the repository;
- result and report artifacts do not copy OCR text or truth text and preserve negative
  OCR/layout/semantic/Track/delivery/WPF/live/readiness dispositions.

## Canonical hashes and outcomes

| Artifact | Raw-byte SHA-256 |
| --- | --- |
| case inventory | `30192916f972cf9dc9adc9efdd761a6f5983305bfda1fa52b9835915fb449154` |
| aggregate report | `3479ee42fbc5d74ac142b9e90b60ed48b4a9c01a5be7ae07b794b8350022ddb8` |
| math request / result | `216830035db6d6fbca14f1f37a829b049f63e7de1ded77e80549b8d3c1f9068e` / `0f3f7dc8f0ac12b5ab86f8a37449a307f5369462656a054d86c38d99775454c9` |
| junior request / result | `7d5933143f38ae7ac5ec7f1fed141cbdf742ad66cb32b5f446355f555a65ade7` / `50be031bfcf9d53b22979ccfdc2a6a61c0d3f2683a4933165e4d1dde4a9abb9b` |
| senior request / result | `89cd5037ecdc55b52cc5c68e2eb79f540280f243c0ee83e88103fc2b6c9f8cdc` / `f42de43cb9d3848581aefda578f76ae71644cacb9da0540de3f9bbe8725cfb19` |

The report contains 3 cases, 25 text-region candidates, 1 OCR observation, zero matched
associations, 25 unmatched candidates, and 1 unmatched observation. Its dispositions remain
`not_accepted`, `not_inferred`, `not_integrated`, `not_projected`, `not_verified`,
`eligible=false`, and `optimizationCandidateRefs=[]` as applicable.

## Review and focused verification

| Check | Result |
| --- | --- |
| association focused tests | 16/16 passed; no VISION-014 skip |
| canonical fixture replay | 3/3 fixtures validated |
| schema boundary and JSON/Python/Node syntax | passed |
| asset validation | 139 assets, 3 subject packs, 3 snapshots |
| strategy `CrossSubjectContractTests` | 16/16 passed |
| staged secret scan and `git diff --check` | passed |
| independent read-only reviewer | `APPROVE`; 0 Critical and 0 Required findings |

The reviewer independently checked strategy and D-032, all four schemas, runtime policy,
canonical request/result/inventory/report assets, validator and hotspot wiring, and README
boundaries. It independently replayed 16/16 focused tests, 3/3 canonical fixtures,
`validate:assets`, and `git diff --check`.

Two Optional findings remain non-blocking: the ambiguity unit regression directly exercises
many candidates to one observation while the implementation checks both endpoints, and the
972-line runtime should be split into authority loading, policy, and report/promotion modules
before future layout or semantic expansion. Neither changes the current verified behavior.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit`. Build and test used the prepared local .NET SDK
`10.0.301` by temporarily prepending
`%TEMP%\classroom-toolkit-dotnet-10.0.301` to `DOTNET_ROOT` and `PATH`; bootstrap was not run and
`global.json` was not changed.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 139 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; VISION-014 16/16 and 3/3 canonical fixtures passed |

The fixed-order wrapper exited 0 in 699.3 seconds. The hotspot also validated `.env.example`
with missing secrets allowed, `cloud egress: disabled`, and six synthetic gateway
request/failover contract tests. It did not read or modify a committed `.env`, print secrets, or
make a live provider request. No gateway code or local configuration changed in VISION-014, so no
standalone local-config validation was required.

## N/A records

### Existing visual symlink alias probes

- classification: `platform_na`
- reason: this Windows host denied symlink creation with `WinError 1314` in pre-existing visual
  path-alias tests; VISION-014 adds no symlink-dependent positive behavior.
- alternative_verification: canonical traversal rejects symlink/junction entries; hardlink
  physical-identity, copied-root, nested-authority, path escape, raw-byte snapshot, TOCTOU, crop
  authority, and staged-promotion tests executed in the hotspot. VISION-014's own 16 tests had no
  skip.
- evidence_link: this document, the final hotspot output, and VISION-007 through VISION-013
  evidence records.
- expires_at: next run on a host or session with symlink privilege, or when canonical path
  admission changes, whichever occurs first.
- recovery_condition: run the unchanged focused suites with symlink capability and require every
  alias probe to pass without skip.

### Answer graphics smoke

- classification: `gate_na`
- reason: `answer-graphics` remains experimental and outside the default product gate; VISION-014
  does not change its code, schema, or runtime.
- alternative_verification: assets, association and other visual diagnostics, visual evidence,
  renderer, cross-subject evals, sample flywheel, and OCR import gates all executed in the fixed
  hotspot.
- evidence_link: this document and the final hotspot output stating that answer graphics smoke is
  skipped because it is experimental and not part of the default toolchain gate.
- expires_at: when answer-graphics becomes part of the default delivery contract or a future slice
  modifies it.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in fixed gate
  order.

## Rollback and residual risk

- rollback VISION-014 in reverse dependency order: the commit containing this evidence,
  implementation commit `2862d08`, then strategy commit `b090082`;
- preserve VISION-007 through VISION-013 authorities, `.env`, OCR environments, gateway
  configuration, delivery/review authorities, readiness receipts, sample-flywheel authorities,
  generated candidates, and teacher-feedback authorities during rollback;
- the canonical fixture set has no positive association and therefore proves conservative
  unmatched/unavailable behavior, not recall or precision on positive data;
- OCR correctness, layout and subject semantics, `FigureUnderstandingResult`, Track B/C runtime,
  WPF/default answer workflow integration, attested controls, live provider validation, Typst
  parity/migration, and workstation/live acceptance require separate admitted slices.

## Acceptance boundary

- `repo-side done`: pending this evidence commit, push, and remote parity. Strategy truth, schemas,
  provider-neutral runtime, canonical assets/report, deterministic validation, review closure, and
  fixed gates are complete.
- `gateway verified`: unchanged; only config plus synthetic request/failover contracts are
  verified. No live gateway/provider validation occurred.
- `workflow integrated`: no. The association tool is standalone and does not write review state,
  delivery trust, readiness, WPF state, or default answer workflow state.
- `live accepted`: no.
- `readiness controls`: unchanged. `ReadinessControlReceipt` remains
  `unattested_local_record`; toolchain/restricted-egress controls remain `not_verified`;
  `eligible=false`; no `OptimizationCandidate` was generated.
- `still open`: trustworthy toolchain/restricted-egress attestation, real-data acceptance,
  delivery trust projection, and every residual product/runtime item listed above.
