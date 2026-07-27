# FLYWHEEL-010 Teacher Feedback Replay Evidence

## Goal and landing point

- starting point: FLYWHEEL-009 made teacher-feedback structured ingestion rates
  reproducible, while the PRD's automatic replay pass-rate metric existed only
  as test behavior and not as a versioned diagnostic artifact.
- target: replay the deterministic teacher parser against every canonical
  synthetic expected result and compile an independent byte-exact
  `TeacherFeedbackReplayDiagnosticReport`.
- rollback: revert the FLYWHEEL-010 implementation and strategy commits; remove
  only the replay schema/report, compiler additions, parser authority loader,
  tests, validation, and documentation. Preserve FLYWHEEL-008/009 authority,
  readiness, `.env`, external receipts, WPF, real data, and cloud-egress state.

## Design decision

- extending the ingestion report was rejected because structured/human-label
  rates and replay compatibility measure different failure surfaces.
- relying on test logs alone was rejected because logs are not a stable,
  hash-bound, versioned product metric.
- the selected independent replay report reuses the canonical teacher inventory
  without treating replay attempts as candidate evaluation units.

## Changes and invariants

- added a strict provider-neutral replay report schema with per-fixture
  submission, expected-result, and replayed-result SHA-256 bindings.
- the replay authority loader still validates the fixed inventory schema,
  unique refs, raw-byte hashes, realpath-contained refs, expected-result schema,
  and exact submission/result coverage. The original canonical validator still
  performs full current-parser semantic equality.
- replay serializes the current parser result as two-space JSON plus a trailing
  LF, then compares the Buffer directly with frozen expected result bytes.
  `.gitattributes` fixes `eval/sample-flywheel/**/*.json` to LF.
- a schema-valid byte mismatch is recorded as `failed`; malformed authority or
  malformed replay output fails closed instead of becoming a metric.
- `validate:assets` performs shape validation and deterministic semantic
  recompile, then rejects a canonical report unless `failedCount=0` and
  `passRate=1`.
- CLI output must remain outside the repository. Direct repository paths,
  symlink/junction ancestors, and any existing hardlink output are rejected;
  rejection preserves authority bytes.
- `optimizationCandidateRefs` has `maxItems=0`. No ingestion diagnostic,
  readiness, qualification, controls, eligibility, generated fixture, WPF,
  provider config, `.env`, or cloud-egress setting changed.

## Replay result

- `totalReplays=3`.
- `passedCount=3`.
- `failedCount=0`.
- `passRate=1`.
- every `expectedResultSha256` equals its `replayedResultSha256`.
- `optimizationCandidateRefs=[]` and stop reason is
  `teacher_feedback_replay_diagnostic_only_no_optimizer`.

This result proves byte-exact compatibility only for the three controlled
public synthetic fixtures. It is not real-teacher language accuracy, semantic
correctness, model quality, or production acceptance.

## Independent review

- final read-only verdict: `APPROVE`, with `0 Critical / 0 Required`.
- reviewer confirmed the expected-authority versus replay-mismatch boundary,
  stable byte serialization, schema constraints, canonical green policy,
  output alias protection, and unchanged ingestion/readiness authorities.
- Optional future test depth: split hardlink and junction capability cases;
  add isolated corruption cases for loader schema/hash/path/coverage; add a
  direct failure-path test for the `validate:assets` zero-failure policy; expand
  mismatch tests with explicit before/after bytes for every protected authority.
  These do not block the current implementation.

## Verification

Executed on 2026-07-27 in the required order using the existing task-local
`.NET SDK 10.0.301` runtime:

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 116/116 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 71 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 |
| focused teacher diagnostic/replay tests | 10/10 passed |
| sample-flywheel hotspot | 72 passed, 0 failed, 1 capability skip |
| answer-generator hotspot | 8/8 passed |
| AI gateway config template and synthetic vision contracts | config valid with cloud egress disabled; 6/6 passed |
| visual DecisionRecord contracts | 11/11 passed |
| delivery aggregate contracts | 59/59 passed |
| renderer, cross-subject, subject evals, and OCR | passed |
| independent read-only review | final `APPROVE`; no Critical or Required finding |

No bootstrap, local `.env` mutation, live provider request, cloud-backed visual
lane, real teacher/student/paper data, WPF workflow integration, or external
data transmission ran.

## N/A records

### Live gateway probes

- reason: FLYWHEEL-010 is a deterministic offline replay diagnostic; cloud
  egress remains disabled and no external transmission was authorized.
- alternative_verification: `.env.example` config validation and six synthetic
  request/failover contracts passed in `check-toolchain`.
- evidence_link:
  `docs/change-evidence/20260727-flywheel010-teacher-replay.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly enable cloud egress, use only synthetic or
  de-identified inputs, and separately run primary, fallback, and forced
  primary-failure probes.

### Trusted toolchain and restricted-egress attestation

- reason: the current `ReadinessControlReceipt` remains an
  `unattested_local_record`; local green gates do not prove trusted runner
  provenance or observed egress restriction.
- alternative_verification: the fixed local gate sequence passed, while the
  readiness report intentionally preserves both controls as `not_verified` and
  `eligible=false`.
- evidence_link:
  `docs/change-evidence/20260727-flywheel010-teacher-replay.md`.
- expires_at: when a signed or otherwise trusted gate and egress authority is
  implemented.
- recovery_condition: verify protected provenance and observed egress control,
  then update readiness in a separate reviewed slice.

### Symlink escape capability test

- reason: Windows returned `EPERM` for the existing capability-gated sample-run
  symlink fixture.
- alternative_verification: parent/absolute escape, realpath containment,
  junction ancestor, hardlink alias, repository-root output, and readiness-byte
  preservation tests passed.
- evidence_link: `tools/sample-flywheel/sample-run.test.mjs` and
  `tools/sample-flywheel/teacher-feedback-diagnostic.test.mjs`.
- expires_at: next run on a host with symlink creation capability.
- recovery_condition: enable Windows Developer Mode/elevation or use a
  non-Windows CI runner, then require the symlink case to pass without skip.

### Answer graphics smoke

- reason: `answer-graphics` remains experimental and is excluded from the
  default toolchain gate.
- alternative_verification: renderer smoke, visual evidence contracts, and all
  subject answer evals passed.
- evidence_link:
  `docs/change-evidence/20260727-flywheel010-teacher-replay.md`.
- expires_at: when a reviewed decision promotes answer graphics into the
  default product contract.
- recovery_condition: add a governed production contract, tests, and default
  gate entry in a separate slice.

## Truth boundary

- `repo-side done`: FLYWHEEL-010 design, schema, authority loader, replay
  compiler, canonical report, semantic validation, documentation, independent
  review, fixed-order gates, and evidence are complete.
- `gateway verified`: configuration template plus synthetic request/failover
  contracts only. No live provider request ran.
- `workflow integrated`: no. Replay diagnostics are not connected to candidate
  readiness or the WPF main answer workflow.
- `live accepted`: no.
- `still open`: real or de-identified teacher feedback acceptance, open-domain
  interpretation, truthful historical/live samples, semantic answer grading,
  trusted toolchain/egress attestation, `OptimizationCandidate`, grey rollout,
  WPF integration, live gateway verification, and live acceptance.
