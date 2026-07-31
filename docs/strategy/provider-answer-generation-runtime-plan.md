# Provider Answer Generation Runtime Plan

## Boundary

GEN-004 adds an explicit model-provider runtime between a problem artifact and an `answer.md`
candidate. It reuses the OpenAI-compatible text gateway and failover implementation while keeping
generation separate from PDF delivery and WPF review/trust writeback.

## Admission

- The request must classify data as `public`, bind problem raw bytes, and bind the current
  `prompts/<subject-pack>/spec.md` raw bytes.
- Request `egressPolicy.allowCloud`, CLI `--allow-cloud-egress`, and gateway cloud-egress config must
  all be true. Missing any layer blocks before provider dispatch.
- Problem/request stay within an explicit workspace. Candidate output must be a new directory outside
  workspace and repository authority.

## Execution

The runtime builds one Markdown-only prompt from bound instruction and problem authorities. The
gateway supports Responses and Chat Completions, sends a bounded output-token request, and retries
only retryable failures through configured fallback providers. Request/problem/spec/config bytes are
snapshotted and rechecked before staged candidate/result bytes are atomically promoted.

Every model-provider result records provider role, model, surface, attempt count, and cloud egress.
It is always `pending_review`, `trusted=false`, and `workflowDisposition=not_integrated`; it cannot
directly change delivery trust or lifecycle.

## Verification And Truth

Tests mock both OpenAI-compatible surfaces and provider failures without real credentials or network
egress. They prove request shaping, failover, authority checks, and atomic fail-closed behavior only.
Live gateway verification, answer quality, WPF default workflow integration, review approval,
workstation acceptance, and live acceptance remain open. No `OptimizationCandidate` is generated.

## Rollback

Rollback the GEN-004 atomic commit. Remove the provider runtime/tests/strategy/evidence and restore
the additive generation schema/domain and gateway max-token interface. Preserve GEN-003 canonical
fixtures, `.env`, local provider configuration, and external user outputs.
