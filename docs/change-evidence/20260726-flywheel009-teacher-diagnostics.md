# FLYWHEEL-009 Teacher Feedback Diagnostics Evidence

## Goal and landing point

- starting point: FLYWHEEL-008 could deterministically parse three canonical
  public synthetic teacher-text fixtures, but the repository had no independent
  structured-ingestion diagnostic aggregate.
- target: compile and semantically revalidate one provider-neutral
  `TeacherFeedbackDiagnosticReport` without admitting teacher results into
  candidate readiness, qualification, controls, or eligibility.
- rollback: revert the FLYWHEEL-009 implementation and strategy commits; remove
  only the diagnostic schema/compiler/test/report and related validation and
  documentation. Preserve FLYWHEEL-008 authority, readiness, `.env`, external
  receipts, WPF, real data, and cloud-egress configuration.

## Changes and invariants

- added a strict report schema with complete 9-category error, 4-category
  severity, and 5-category human-label reason distributions. Zero-count
  categories remain explicit and additional properties are rejected.
- the compiler first revalidates the canonical teacher fixture inventory and
  then binds the inventory and every `FeedbackParseResult` by raw-byte SHA-256.
- the committed report is validated by both schema shape and deterministic
  semantic recompile in `validate:assets`.
- `optimizationCandidateRefs` has `maxItems=0`; the report contains no readiness
  buckets, qualification, controls, or `eligible` field.
- CLI output must remain outside the repository. Direct repository paths,
  canonical roots, junction ancestors, and physical hardlink aliases fail
  closed. Rejection preserves authority bytes.
- no readiness input/report, generated fixture, `OptimizationCandidate`, WPF
  path, provider configuration, `.env`, or cloud-egress setting was changed.

## Diagnostic result

- `totalSubmissions=3`, `parsedCount=2`, `needsHumanLabelCount=1`.
- `structuredRate=0.666667`, `humanLabelRate=0.333333`.
- error types: `reasoning_error=1`, `format_error=1`; all other categories are
  present with zero counts.
- severities: `low=1`, `medium=1`, `high=0`, `critical=0`.
- reason codes: `ambiguous_error_signal=1`; all other categories are present
  with zero counts.
- `optimizationCandidateRefs=[]` and stop reason is
  `teacher_feedback_diagnostic_only_no_optimizer`.

These rates describe only the three controlled synthetic fixtures. They are not
real-teacher language understanding accuracy, model quality, or production
acceptance.

## Independent review

- initial verdict: `0 Critical / 1 Required / 1 Optional`, request changes.
- Required finding: the initial output guard could target readiness or other
  repository-owned canonical assets. The compiler now rejects the complete
  repository root and a regression proves readiness bytes remain unchanged.
- Optional finding: hardlink capability failure is now handled with an explicit
  platform skip. Splitting the combined hardlink/junction test remains a
  non-blocking future test-organization improvement.
- final read-only verdict: `APPROVE`, `0 Critical / 0 Required`.

## Verification

Executed on 2026-07-26 in the required order using the existing task-local
`.NET SDK 10.0.301` runtime:

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 116/116 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 70 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 |
| focused teacher diagnostic tests | 5/5 passed |
| sample-flywheel hotspot | 67 passed, 0 failed, 1 capability skip |
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

- reason: FLYWHEEL-009 is a deterministic offline diagnostic slice; cloud
  egress remains disabled and no external transmission was authorized.
- alternative_verification: `.env.example` config validation and six synthetic
  request/failover contracts passed in `check-toolchain`.
- evidence_link:
  `docs/change-evidence/20260726-flywheel009-teacher-diagnostics.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly enable cloud egress, use only synthetic or
  de-identified inputs, and separately run primary, fallback, and forced
  primary-failure probes.

### Trusted toolchain and restricted-egress attestation

- reason: the current `ReadinessControlReceipt` remains an
  `unattested_local_record`; passing local gates does not establish trusted
  runner provenance or observed egress restriction.
- alternative_verification: the fixed local gate sequence passed, while the
  readiness report intentionally preserves both controls as `not_verified` and
  `eligible=false`.
- evidence_link:
  `docs/change-evidence/20260726-flywheel009-teacher-diagnostics.md`.
- expires_at: when a signed or otherwise trusted gate and egress authority is
  implemented.
- recovery_condition: verify protected provenance and observed egress control,
  then update readiness in a separate reviewed slice.

### Symlink escape capability test

- reason: Windows returned `EPERM` for the existing capability-gated sample-run
  symlink fixture.
- alternative_verification: parent/absolute escape, realpath containment,
  junction ancestor, hardlink physical-identity, and repository-root output
  rejection tests passed.
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
  `docs/change-evidence/20260726-flywheel009-teacher-diagnostics.md`.
- expires_at: when a reviewed decision promotes answer graphics into the
  default product contract.
- recovery_condition: add a governed production contract, tests, and default
  gate entry in a separate slice.

## Truth boundary

- `repo-side done`: FLYWHEEL-009 schema, compiler, canonical report, semantic
  validation, documentation, independent review, fixed-order gates, and
  evidence are complete.
- `gateway verified`: configuration template plus synthetic request/failover
  contracts only. No live provider request ran.
- `workflow integrated`: no. Teacher diagnostics are not connected to candidate
  readiness or the WPF main answer workflow.
- `live accepted`: no.
- `still open`: real or de-identified teacher feedback acceptance, open-domain
  language interpretation, truthful historical/live samples, semantic answer
  grading, trusted toolchain/egress attestation, `OptimizationCandidate`, grey
  rollout, WPF integration, live gateway verification, and live acceptance.
