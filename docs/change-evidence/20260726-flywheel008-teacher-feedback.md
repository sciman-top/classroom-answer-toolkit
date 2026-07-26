# FLYWHEEL-008 Synthetic Teacher Feedback Evidence

## Goal and landing point

- starting point: generated candidates reached the synthetic readiness bucket,
  but feedback parsing accepted only fixture labels already embedded in scoring
  runs. No teacher-text input contract or human-label queue existed.
- target: compile repository-owned public synthetic teacher-text submissions
  into byte-bound `FeedbackParseResult` v2 artifacts through a bounded explicit
  lexicon, while failing closed on missing, ambiguous, or negated signals.
- rollback: revert the FLYWHEEL-008 commit, remove the teacher fixture inventory,
  submissions/results, parser and schema, restore FeedbackParseResult v1 and the
  prior auto feedback/readiness hashes. Do not alter `.env`, machine-local
  receipts, cloud-egress settings, real data, WPF workflow, or live providers.

## Contracts and authority

- `TeacherFeedbackSubmission` is separate from delivery and generation request
  contracts. It binds sample/subject identity, a relative scoring-run ref, raw
  run SHA-256, public classification, explicit `synthetic_fixture` provenance,
  synthetic reporter identity, text, and canonical timestamp.
- a canonical fixture inventory binds exactly three admitted submission/result
  pairs by repository-relative path and raw-byte SHA-256. Recursive exact
  coverage rejects orphan or unlisted teacher fixture files.
- arbitrary caller-labelled temporary submissions are rejected even when their
  fields claim public synthetic provenance.
- FeedbackParseResult v2 has three mutually exclusive schema shapes: auto
  parsed, teacher parsed, and teacher `needs_human_label`. Schema-only validation
  enforces parse mode/disposition, record count/source, queue/reason fields,
  stop reason, and empty optimization refs.
- the finite lexicon covers nine root-cause types, four severities, and explicit
  negation prefixes. It is not open-domain natural-language interpretation.
- unique non-negated error and severity signals produce one
  `source=teacher_input` record. Missing, ambiguous, or recognized negated
  signals produce no record and enter `needs_human_label` with a stable reason.
- result recomputation binds current canonical run authority plus submission raw
  bytes. Run, input, inventory, result, computed field, path, hardlink, direct
  alias, and junction-ancestor drift fail closed.
- CLI output cannot enter the canonical teacher fixture root or canonical sample
  root and cannot alias selected input/run/sample authority.

## Committed fixtures

| Fixture | Result |
| --- | --- |
| `reasoning-medium` | parsed; `reasoning_error`; medium; one teacher record |
| `format-low` | parsed; `format_error`; low; one teacher record |
| `ambiguous-reasoning-format` | `needs_human_label`; `ambiguous_error_signal`; zero records |

All three use public repository-authored synthetic text, bind existing generated
scoring runs, recompile deterministically, and keep
`optimizationCandidateRefs=[]`.

## Readiness result

- teacher-text results are intentionally rejected by the current readiness
  consumer, which remains auto-fixture-only.
- `perturbed_negative`: raw `n=1`, recall `1`; qualified `n=0`.
- `historical_candidate`: raw `n=0`; qualified `n=0`.
- `generated`: raw `n=3`, expected errors `3`, detected `3`, recall `1`;
  qualified `n=0`, qualified recall unavailable.
- `toolchainStatus=not_verified` and
  `restrictedEgressStatus=not_verified`.
- `eligible=false`, reason codes remain
  `non_perturbed_qualified_sample_count_insufficient`,
  `toolchain_not_verified`, and `restricted_egress_not_verified`.
- `optimizationCandidateRefs=[]`.

## Independent review

- initial read-only review: 0 Critical, 3 Required, 2 Optional. Required items
  found incomplete schema shape invariants, caller-asserted rather than
  canonical synthetic authority, and a missing-ancestor junction output bypass.
- first fixes: added schema `oneOf/anyOf/not/minItems/maxItems` support and
  mutually exclusive result shapes; added the canonical hash inventory and
  recursive exact coverage; changed path canonicalization to resolve the nearest
  existing ancestor; added a passing junction regression and finite negation
  handling.
- follow-up review: 0 Critical, 1 Required. It found schema-only consumers could
  still mix record sources or accept non-empty optimization refs.
- final fixes: constrained auto/teacher record source per branch and set
  `optimizationCandidateRefs.maxItems=0`, with cross-source and non-empty-ref
  mutation tests on both result paths.
- final read-only review: APPROVE, 0 Critical, 0 Required, 2 Optional.
- optional residuals: generic object/array `const` deep equality is not
  implemented because this slice uses primitive const only; negation handling is
  intentionally a finite prefix lexicon under canonical fixture authority.

## Verification

Executed on 2026-07-26 in the required order using the existing task-local
`.NET SDK 10.0.301`. No bootstrap, local `.env` mutation, live request, or cloud
egress ran.

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 116/116 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 69 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; math snapshot contract passed |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; toolchain complete |
| sample-flywheel hotspot | 62 passed, 0 failed, 1 capability skip |
| teacher junction ancestor regression | passed on Windows junction capability |
| answer-generator hotspot | 8/8 passed |
| AI gateway template config | valid with cloud egress disabled and missing secrets explicitly allowed |
| AI gateway vision contracts | 6/6 synthetic request/failover tests passed |
| visual DecisionRecord contracts | 11/11 passed |
| delivery aggregate contracts | 59/59 passed |
| renderer and subject evals | smoke plus junior/senior physics and math passed |
| OCR | local venv imports passed |
| independent read-only review | APPROVE; 0 Critical, 0 Required |

## N/A records

### Live provider and failover probes

- reason: FLYWHEEL-008 changes only local canonical synthetic feedback contracts;
  cloud egress was not authorized and remained disabled.
- alternative_verification: gateway template config validation and six synthetic
  vision request/failover contracts passed inside the toolchain gate.
- evidence_link:
  `docs/change-evidence/20260726-flywheel008-teacher-feedback.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly authorize cloud egress, use only synthetic or
  lawfully de-identified inputs, and separately run primary, fallback, and
  forced-primary-failure probes.

### Trusted toolchain and restricted-egress controls

- reason: local passing gates and `ReadinessControlReceipt` remain
  `unattested_local_record`; they do not prove protected runner provenance or
  observed network restriction.
- alternative_verification: the complete fixed local gate sequence passed while
  readiness intentionally retained both controls as `not_verified`.
- evidence_link:
  `docs/change-evidence/20260726-flywheel008-teacher-feedback.md`.
- expires_at: when trusted signed/attested gate and egress authorities exist.
- recovery_condition: verify protected runner provenance and observed egress
  control in a separately reviewed authority slice.

### Sample-run symlink escape capability case

- reason: Windows returned `EPERM` for the existing sample-run symlink fixture.
  The new teacher-feedback junction-ancestor regression did execute and pass.
- alternative_verification: absolute/parent escape, realpath containment,
  hardlink identity, teacher junction ancestor, and readiness symlink ancestor
  tests passed.
- evidence_link: `tools/sample-flywheel/sample-run.test.mjs` and
  `tools/sample-flywheel/teacher-feedback-parse.test.mjs`.
- expires_at: next run on a host with symlink creation capability.
- recovery_condition: enable Windows Developer Mode/elevation or use a
  non-Windows CI runner, then require the skipped sample-run case to execute.

### Answer graphics smoke

- reason: `answer-graphics` remains experimental and outside the default
  product toolchain.
- alternative_verification: renderer smoke, visual evidence contracts, and all
  subject answer evals passed.
- evidence_link:
  `docs/change-evidence/20260726-flywheel008-teacher-feedback.md`.
- expires_at: when a reviewed decision promotes answer graphics into the
  default product contract.
- recovery_condition: add a governed production contract, tests, and default
  gate entry in a separate slice.

## Truth boundary

- `repo-side done`: strategy, v2 schema migration, canonical synthetic fixture
  authority, parser, human-label routing, generated artifacts, tests, complete
  gates, evidence, and independent review are complete. Commit and push are
  pending at this evidence capture.
- `gateway verified`: configuration template plus synthetic request/failover
  contracts only. No live provider request ran.
- `workflow integrated`: no. Teacher-text parsing is not connected to readiness
  scoring or the WPF answer workflow.
- `live accepted`: no.
- `still open`: trusted toolchain/restricted-egress controls, authorized real
  teacher-data admission, open-domain language interpretation, teacher feedback
  readiness policy, semantic answer grading, historical samples,
  `OptimizationCandidate`, WPF integration, live gateway verification, and live
  acceptance.
