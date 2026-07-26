# FLYWHEEL-005 Optimization Readiness Evidence

## Scope

- current landing point: FLYWHEEL-004 can compile one hash-bound synthetic
  `FeedbackParseResult`, but the repository had no honest bucket readiness
  denominator or fail-closed release evaluation.
- target landing point: bind a canonical expected-case inventory to complete
  runtime run/feedback bindings and compile a per-`candidateSourceType`
  `OptimizationReadinessReport`.
- rollback: revert the FLYWHEEL-005 commit. Independently inventory and remove
  any untracked CLI outputs before rollback; do not alter canonical sample
  assets or local `.env`.

## Changes

- added case-inventory, readiness-input, and readiness-report schemas.
- added an offline compiler with current canonical descriptor, run, feedback,
  raw-byte SHA-256, realpath containment, and physical alias checks.
- fixed the canonical inventory name to the sibling
  `readiness-case-inventory.json`; assets requires the inventory/input/report
  triplet and semantically recompiles the report.
- preserved missing run/feedback cases in the recall denominator; rejected
  duplicate evaluation units, incomplete input coverage, reused run hashes,
  alternative inventories, drifted authority, and computed-field tampering.
- positive toolchain and restricted-egress controls remain unsupported until
  verifiable receipts exist. The current compiler accepts only `not_verified`,
  cannot emit `eligible=true`, and never creates an `OptimizationCandidate`.

## Fixture Result

- `perturbed_negative`: `n=1`, expected `1`, detected `1`, recall `1.0`.
- `historical_candidate`: `n=0`, recall unavailable.
- `generated`: `n=0`, recall unavailable.
- `eligible=false`.
- reasons: `non_perturbed_bucket_sample_count_insufficient`,
  `toolchain_not_verified`, `restricted_egress_not_verified`.
- all fixture data is fully synthetic; no real exam paper was used or sent.

## Verification

Executed on 2026-07-26 in required order:

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 114/114 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 53 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 |
| sample-flywheel hotspot within toolchain | 34 passed, 0 failed, 1 platform skip |
| AI gateway vision contracts within toolchain | 6/6 passed using synthetic inputs |
| DecisionRecord contracts within toolchain | 11/11 passed |
| delivery aggregate contracts within toolchain | 59/59 passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid; cloud egress disabled |
| independent read-only review | final verdict: No blocker |

## N/A Records

### Live primary/fallback/forced-failure probes

- reason: cloud egress is disabled and this slice is an offline readiness
  compiler. The user did not authorize external transmission for this run.
- alternative_verification: gateway config validation and six synthetic vision
  request/failover contract tests passed in `check-toolchain`.
- evidence_link: `docs/change-evidence/20260726-optimization-readiness-report.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: enable cloud egress explicitly, use only synthetic or
  de-identified images, then verify primary, fallback, and forced-primary-failure
  auto-switch separately.

### Symlink containment case

- reason: Windows returned `EPERM` while creating the capability-gated symlink
  fixture. No symlink was created or followed.
- alternative_verification: realpath parent-escape rejection and hardlink
  physical-identity alias tests passed; canonical path checks remain active.
- evidence_link: `tools/sample-flywheel/sample-run.test.mjs`.
- expires_at: next run on a host with symlink capability.
- recovery_condition: enable Windows Developer Mode/elevation or use non-Windows
  CI, rerun the sample-flywheel suite, and require no symlink skip.

## Truth Boundary

- `repo-side done`: FLYWHEEL-005 offline canonical inventory, complete runtime
  binding, bucket computation, fail-closed controls, schemas, fixtures, gates,
  strategy, and evidence.
- `gateway verified`: configuration plus synthetic request/failover contracts
  only.
- `workflow integrated`: no; readiness is not connected to the WPF main answer
  workflow.
- `live accepted`: no.
- `still open`: verifiable toolchain/egress receipts, truthful
  `historical_candidate` or `generated` samples, semantic grading, teacher
  free-text parsing, `OptimizationCandidate`, grey rollout, controlled real
  sample acceptance, and WPF workflow integration.
