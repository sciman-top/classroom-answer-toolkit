# Product Core Simplification

## Decision

The active product is a small classroom-answer workstation:

`public or de-identified question → explicit provider generation → answer.md → PDF/review → human judgment`

The product does not currently operate a multi-user review service, an approval system, an optimizer,
or a visual-understanding platform. Existing contracts that support those possibilities remain as
offline developer safeguards; they are not default WPF workflow commitments.

## Keep

- subject-pack/spec snapshot validation and the established `answer.md -> PDF/review` delivery chain;
- GEN-004/005 public-only, explicit cloud-egress, hash-bound provider generation;
- clear `pending_review / trusted=false` defaults and manual review output;
- build, test, asset validation, and toolchain checks that protect the supported path.

## Freeze

- review lifecycle writeback, approval actions, trust-changing UI actions, queue ownership and queue persistence;
- aggregate/DecisionRecord write operations and WPF review-queue projection as developer-only support tools;
- additional synthetic visual semantics, synthetic Track expansion, optimization/governance flywheel work;
- general DOCX reconstruction, advanced image understanding, Typst migration, multi-VLM ensemble, and prompt-prose optimization.

Frozen means no new product code, schema, WPF controls, or roadmap commitment. It does not delete
existing tools, evidence, fixtures, or contracts that may be required to read old deliveries safely.

## Re-enable Criteria

A frozen lane may return only with all applicable evidence below:

1. A real repeated user workflow demonstrates that the current core path cannot serve the need.
2. Named owner/actor, durable input/output location, and rollback boundary are known.
3. A legal real or de-identified corpus exists for evaluation; synthetic fixtures alone are insufficient.
4. A measurable acceptance target exists (for example, correction rate, review time, or failure rate).
5. The proposed change cannot be handled by a narrower CLI or manual operating step.

## Current Acceptance Boundary

- `repo-side done`: GEN-005 WPF provider generation and the core delivery path are implemented and gated.
- `workflow integrated`: generation can populate the WPF delivery input, but delivery remains explicit.
- `gateway verified`, `workstation accepted`, `live accepted`: not verified.
- `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`, `eligible=false` remain unchanged.

## Rollback

This simplification only removes default UI exposure and reprioritizes strategy. Revert its atomic
commit to restore the prior WPF developer controls and broad reading order; retained CLI/tools and
historical evidence require no data migration.
