# FLYWHEEL-007 Generated Qualification Evidence

## Goal and landing point

- starting point: GEN-003 connected three deterministic `synthetic_fixture`
  candidates to the generated readiness bucket. Their raw `n=3/recall=1`
  remained ineligible only because controls were `not_verified`; no separate
  release qualification prevented future accidental admission.
- target: preserve raw diagnostic metrics while requiring canonical,
  provenance-bound release qualification for every non-perturbed admission
  metric.
- rollback: revert the FLYWHEEL-007 commit and restore the previous v1
  SampleRunRecord, inventory, report, run/feedback fixtures, readiness input
  hashes, and report. Do not alter `.env`, machine-local receipts, live provider
  settings, or cloud-egress configuration.

## Changes and invariants

- added a provider-neutral `ReleaseQualification` schema with four strict
  mutually exclusive shapes: `not_applicable`, `diagnostic_only`, `unverified`,
  and future `qualified`.
- the repository's limited schema validator now enforces the `oneOf` and
  primitive `const` keywords used by that contract. Contradictory status/reason
  combinations and diagnostic records without complete evidence fail schema-
  only validation.
- the current runtime never accepts or emits `qualified`. Perturbed negatives
  compile to `not_applicable`; generated deterministic fixtures compile to
  `diagnostic_only`; non-perturbed candidates without admitted authority compile
  to `unverified`.
- generated qualification is derived only from the recompiled canonical
  generation result. It binds repository-relative evidence ref, result raw-byte
  SHA-256, `providerKind=synthetic_fixture`, and `liveProvider=false`.
- inventory, scoring run, and report case binding carry the same qualification.
  Each layer is compared with current canonical authority; caller, inventory,
  run, result, or computed-report drift fails closed.
- each readiness bucket keeps raw metrics and separate `qualified*` metrics.
  Non-perturbed eligibility reads only qualified count and recall.
- adding required qualification and qualified metrics is a breaking migration.
  SampleRunRecord, readiness case inventory, and readiness report were upgraded
  to schema v2 / artifact `2.0`; v1 artifacts must be recompiled from current
  authority. Readiness input and feedback result remain v1 because their shapes
  did not change, while all bound raw-byte hashes were regenerated.
- `optimizationCandidateRefs` remain empty throughout.

## Readiness result

- `perturbed_negative`: raw `n=1`, recall `1`; qualified `n=0`, recall
  unavailable (`not_applicable`).
- `historical_candidate`: raw `n=0`; qualified `n=0`; both recalls unavailable.
- `generated`: raw `n=3`, expected errors `3`, detected `3`, recall `1`;
  qualified `n=0`, qualified recall unavailable (`diagnostic_only`).
- reason codes: `non_perturbed_qualified_sample_count_insufficient`,
  `toolchain_not_verified`, `restricted_egress_not_verified`.
- `toolchainStatus=not_verified` and
  `restrictedEgressStatus=not_verified`.
- `eligible=false` and `optimizationCandidateRefs=[]`.

Raw generated recall remains fixture-label detection coverage. It is not
semantic answer accuracy, release authority, live model quality, or acceptance.

## Independent review

- initial read-only review: 0 Critical, 2 Required. It found that the first
  schema allowed contradictory status/reason pairs and that required-field
  additions were incorrectly presented as an additive v1 change.
- fixes: added strict schema-only `oneOf` validation and regression coverage;
  migrated SampleRunRecord, inventory, and report contracts/artifacts to v2 and
  regenerated the complete raw-byte hash chain.
- follow-up read-only review: APPROVE, 0 Critical, 0 Required, 1 Optional.
- optional residual: the local validator's `const` implementation supports
  primitive values, which covers every const in this slice; object/array const
  support can be added separately without changing qualification semantics.

## Verification

Executed on 2026-07-26 in the required order using the existing task-local
`.NET SDK 10.0.301` runtime. No bootstrap or live probe ran.

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 116/116 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 62 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; toolchain complete |
| sample-flywheel hotspot | 52 passed, 0 failed, 1 capability skip |
| answer-generator hotspot | 8/8 passed |
| AI gateway vision contracts | 6/6 synthetic request/failover tests passed |
| visual DecisionRecord contracts | 11/11 passed |
| delivery aggregate contracts | 59/59 passed |
| renderer and subject evals | smoke plus junior/senior physics and math passed |
| OCR | local venv imports passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local `.env` valid; cloud egress disabled |
| independent read-only review | APPROVE; 0 Critical, 0 Required |

## N/A records

### Live primary/fallback/forced-failure probes

- reason: cloud egress was not authorized and remained disabled; FLYWHEEL-007
  requires no external provider call.
- alternative_verification: gateway config validation passed, and six synthetic
  request/failover contracts passed inside the hotspot gate.
- evidence_link:
  `docs/change-evidence/20260726-flywheel007-generated-qualification.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly enable cloud egress, use only synthetic or
  de-identified inputs, and separately execute primary, fallback, and forced
  primary-failure probes.

### Trusted toolchain and restricted-egress controls

- reason: `ReadinessControlReceipt` remains an `unattested_local_record`; local
  passing gates do not prove runner provenance or observed network restriction.
- alternative_verification: the fixed local gate sequence and config validation
  passed, while readiness intentionally keeps both controls `not_verified`.
- evidence_link:
  `docs/change-evidence/20260726-flywheel007-generated-qualification.md`.
- expires_at: when a trusted signed/attested gate and egress authority exists.
- recovery_condition: verify protected runner provenance plus observed egress
  control, then add `qualified` runtime admission in a separate reviewed slice.

### Symlink escape capability test

- reason: Windows returned `EPERM` when the sample-flywheel suite attempted to
  create its capability-gated symlink fixture.
- alternative_verification: realpath containment, absolute/parent escape,
  junction ancestor, and hardlink physical-identity tests passed.
- evidence_link: `tools/sample-flywheel/sample-run.test.mjs`.
- expires_at: next run on a host with symlink creation capability.
- recovery_condition: enable Windows Developer Mode/elevation or use a
  non-Windows CI runner, then require the symlink case to pass without skip.

### Answer graphics smoke

- reason: `answer-graphics` remains experimental and is excluded from the
  default toolchain gate.
- alternative_verification: renderer smoke, visual evidence contracts, and all
  subject answer evals passed.
- evidence_link:
  `docs/change-evidence/20260726-flywheel007-generated-qualification.md`.
- expires_at: when a reviewed decision promotes answer graphics into the
  default product contract.
- recovery_condition: add a governed production contract, tests, and default
  gate entry in a separate slice.

## Truth boundary

- `repo-side done`: implementation, v2 migration, committed fixture/hash chain,
  focused and full gates, evidence, and independent review are complete. Commit
  and push are pending at this evidence capture.
- `gateway verified`: configuration plus synthetic request/failover contracts
  only. No live provider request ran.
- `workflow integrated`: no. Qualification is not connected to the WPF main
  answer workflow.
- `live accepted`: no.
- `still open`: trusted signed/attested qualification writer and controls,
  truthful historical or authorized live-generated samples, semantic answer
  grading, teacher free-text parsing, `OptimizationCandidate`, grey rollout,
  WPF integration, controlled real-sample acceptance, live gateway verification,
  and live acceptance.
