# GEN-003 Synthetic Answer Generation Evidence

## Goal and landing point

- starting point: FLYWHEEL-006 was repo-side complete, but no answer-generation
  contract or generated candidate was connected to the sample flywheel.
- target: define a provider-neutral generation boundary, materialize three
  deterministic public synthetic fixtures, and connect them through
  `SampleRunRecord -> FeedbackParseResult -> OptimizationReadinessReport`.
- rollback: revert the GEN-003 commit. Remove only the generation schemas,
  domain records, tool, synthetic generation fixtures, generated sample
  artifacts, and corresponding readiness bindings. Restore the prior sample
  package/index and readiness fixture. Do not alter `.env`, machine-local
  receipts, or provider configuration.

## Changes and invariants

- added provider-neutral `AnswerGenerationRequest / AnswerGenerationResult`
  schemas and `ClassroomToolkit.Domain.Generation` records. They contain no
  `AnswerDeliveryRequest` PDF, profile, or review fields.
- the shared result contract can represent a configured model provider, while
  the GEN-003 tool admits only three repository-owned deterministic fixtures.
- every committed synthetic result is explicitly
  `providerKind=synthetic_fixture`, `liveProvider=false`, and uses the
  deterministic local generator identity. A contradictory live synthetic
  provenance fails both standard schema and repository semantic validation.
- request, problem, result, candidate raw UTF-8 bytes, descriptor, package, and
  flat index are SHA-256 bound. Paths are realpath-contained and generated
  descriptor paths must remain inside the canonical sample package.
- `.gitattributes` fixes hash-bound sample, generation-request, and flywheel
  fixture JSON/Markdown bytes to LF across checkouts.
- the three generated negative fixtures are fully synthetic and public. They
  are not model output, historical samples, real papers, or evidence of live
  provider quality.
- generated candidates satisfy current synthetic scoring admission and produce
  source-byte-bound feedback records. All optimization candidate refs remain
  empty.

## Readiness result

- `perturbed_negative`: `n=1`, expected errors `1`, detected `1`, recall `1`.
- `historical_candidate`: `n=0`, recall unavailable.
- `generated`: `n=3`, expected errors `3`, detected `3`, recall `1`.
- `toolchainStatus=not_verified`.
- `restrictedEgressStatus=not_verified`.
- `eligible=false`.
- reason codes: `toolchain_not_verified`,
  `restricted_egress_not_verified`.
- `optimizationCandidateRefs=[]`.

The generated recall is fixture-label detection coverage only. It is not
semantic answer accuracy or live model acceptance.

## Independent review

- first review found one Required issue: the initial shared schemas fixed
  synthetic fixture identity and generator constants, contradicting the
  provider-neutral contract.
- the contract was split correctly: shared request/result/provenance are
  provider-neutral; synthetic identity, version, non-live status, and stop
  reason are enforced by generator admission.
- follow-up review found and closed the contradictory
  `synthetic_fixture + liveProvider=true` case with schema and semantic checks.
- final independent verdict: no blocker and no Required findings.

## Verification

Executed on 2026-07-26 in the required order using the existing task-local
`.NET SDK 10.0.301` runtime:

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 116/116 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 62 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 |
| answer-generator hotspot | 8/8 passed |
| sample-flywheel hotspot | 51 passed, 0 failed, 1 capability skip |
| AI gateway vision contracts | 6/6 synthetic request/failover tests passed |
| visual DecisionRecord contracts | 11/11 passed |
| delivery aggregate contracts | 59/59 passed |
| renderer and subject evals | smoke plus junior/senior physics and math passed |
| OCR | local venv imports passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local `.env` valid; cloud egress disabled |
| independent read-only review | final verdict: no blocker |

No bootstrap, live provider request, cloud-backed visual lane, WPF workflow
integration, or external data transmission ran.

## N/A records

### Live primary/fallback/forced-failure probes

- reason: GEN-003 is restricted to deterministic synthetic fixtures and cloud
  egress remains disabled; external transmission was neither required nor
  authorized.
- alternative_verification: gateway config validation passed and six synthetic
  request/failover contracts passed inside the hotspot gate.
- evidence_link:
  `docs/change-evidence/20260726-gen003-synthetic-answer-generation.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly enable cloud egress, use only synthetic or
  de-identified inputs, and separately run primary, fallback, and forced
  primary-failure probes.

### Trusted toolchain and restricted-egress attestation

- reason: the existing `ReadinessControlReceipt` is only an
  `unattested_local_record`; GEN-003 is prohibited from promoting its authority.
  Passing local gates does not prove runner provenance or observed network
  restriction.
- alternative_verification: the fixed local gate sequence and gateway config
  validation passed, but readiness intentionally preserves both controls as
  `not_verified`.
- evidence_link:
  `docs/change-evidence/20260726-gen003-synthetic-answer-generation.md`.
- expires_at: when a trusted signed/attested gate and egress authority is
  implemented.
- recovery_condition: verify a protected provenance mechanism and observed
  egress control, then update the readiness contract in a separate reviewed
  slice.

### Symlink escape capability test

- reason: Windows returned `EPERM` when the sample-flywheel suite attempted to
  create its capability-gated symlink fixture.
- alternative_verification: realpath containment, absolute/parent escape,
  descriptor package-root containment, junction ancestor, and hardlink
  physical-identity tests passed.
- evidence_link:
  `tools/answer-generator/synthetic-generator.test.mjs`.
- expires_at: next run on a host with symlink creation capability.
- recovery_condition: enable Windows Developer Mode/elevation or use a
  non-Windows CI runner, then require the symlink case to pass without skip.

### Answer graphics smoke

- reason: `answer-graphics` remains experimental and is explicitly excluded
  from the default toolchain gate.
- alternative_verification: renderer smoke, visual evidence contracts, and all
  subject answer evals passed.
- evidence_link:
  `docs/change-evidence/20260726-gen003-synthetic-answer-generation.md`.
- expires_at: when a reviewed decision promotes answer graphics into the
  default product contract.
- recovery_condition: add a governed production contract, tests, and default
  gate entry in a separate slice.

## Truth boundary

- `repo-side done`: GEN-003 contracts, deterministic synthetic generator,
  three generated fixtures, canonical provenance/hash validation, generated
  run/feedback/readiness integration, strategy truth, independent review,
  fixed-order gates, and evidence are complete. Commit and push are pending at
  this evidence capture.
- `gateway verified`: configuration plus synthetic request/failover contracts
  only. No live provider request ran.
- `workflow integrated`: no. The generation slice is not connected to the WPF
  main answer workflow.
- `live accepted`: no.
- `still open`: truthful historical or live-generated samples, semantic answer
  grading, teacher free-text parsing, trusted toolchain/egress attestation,
  `OptimizationCandidate`, grey rollout, WPF integration, controlled real
  sample acceptance, live gateway verification, and live acceptance.
