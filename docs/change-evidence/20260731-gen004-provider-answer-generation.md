# GEN-004 Provider Answer Generation Evidence

Date: 2026-07-31

## Scope

GEN-004 adds an explicit provider-backed runtime from a hash-bound public problem and current
subject-pack spec to an external `answer.md` candidate. It reuses the text gateway's Responses/Chat
Completions and retryable failover behavior. It does not integrate WPF or approve the answer.

## Test-First Evidence

The first test run failed because `provider-generator.mjs` did not exist. After implementation, one
assertion failed only because its regular expression was case-sensitive while the runtime correctly
reported `Instruction authority drifted.`; the test was corrected without changing runtime behavior.

Focused verification:

| verification | result |
| --- | --- |
| `npm --prefix tools/answer-generator test` | exit 0; 13 passed; 0 failed |
| `npm --prefix tools/answer-generator run validate:fixtures` | exit 0; 3 GEN-003 synthetic fixtures byte-exact |
| focused `AnswerGenerationContractTests` | exit 0; 3 passed; 0 failed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots |

No real credential, remote provider, or external network was used. Tests replace `fetch` with local
mock Responses/Chat Completions responses and a retryable primary failure.

## Five-Axis Review

1. Functional: a successful provider response becomes external `answer.md` plus a schema-bound result;
   primary retryable failure can use the configured fallback.
2. Contract: request instruction/egress authority, .NET domain, model-provider provenance, bounded
   output tokens, and pending-review disposition are additive to GEN-003.
3. Security: public-only admission; request, CLI, and gateway egress authorization; problem/spec/config
   snapshots; workspace/repository output exclusion; bounded input/output; staged reread and atomic
   directory promotion are fail closed.
4. Compatibility: the three GEN-003 requests/results/candidates remain byte-exact and the gateway's
   existing probes retain the default eight-token request when no new bound is supplied.
5. Truth: local mocks prove repo-side request shaping/failover only. Every provider result is
   `pending_review`, `trusted=false`, and `workflowDisposition=not_integrated`.

## Fixed Gates

| order | command | result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings; 0 errors; 9.2 s |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 122 passed; 0 failed; 0 skipped; 15.5 s |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots; 5.6 s |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 1140.8 s; toolchain complete |

Build/test use the temporary pinned SDK 10.0.301 only in those subprocesses. No bootstrap or system SDK
change is permitted.

## Acceptance Boundary

- `repo-side done`: implementation and fixed gates are complete on this branch candidate; the atomic
  commit containing this record is the repository evidence boundary.
- `workflow integrated`: no; WPF does not call this runtime.
- `gateway verified`: no; no real provider observation exists.
- `workstation accepted`: no.
- `live accepted`: no.
- review/trust: provider candidates remain `pending_review / trusted=false`.
- readiness: controls remain `not_verified`, `eligible=false`; no `OptimizationCandidate` is generated.

## Rollback

Rollback the GEN-004 atomic commit. Remove provider runtime/tests/strategy/evidence and restore the
additive generation schema/domain and gateway max-token interface. Preserve GEN-003 canonical
fixtures, `.env`, local provider configuration, and external user outputs.
