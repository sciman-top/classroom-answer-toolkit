# Product Core Simplification

## Decision

The active product is a small classroom-answer workstation:

`public or de-identified question → explicit provider generation → answer.md → PDF/review → human judgment`

The product does not currently operate a multi-user review service, an approval system, an optimizer,
or a general visual-understanding platform. Historical contracts that supported those possibilities
are audit history, not active product safeguards.

## Keep

- subject-pack/spec snapshot validation and the established `answer.md -> PDF/review` delivery chain;
- GEN-004/005 public-only, explicit cloud-egress, hash-bound provider generation;
- clear candidate / visual-audited / reference-reviewed / teacher-accepted boundaries;
- build, test, asset validation, and toolchain checks that protect the supported path.

## Freeze

- review lifecycle writeback, approval actions, trust-changing UI actions, queue ownership and queue persistence;
- historical aggregate/decision write operations and WPF review-queue projection;
- additional synthetic visual semantics, synthetic Track expansion, optimization/governance flywheel work;
- general DOCX reconstruction, advanced image understanding, Typst migration, multi-VLM ensemble, and prompt-prose optimization.

Frozen means no new product code, schema, WPF controls, gate, spec wording or roadmap commitment.
Code, schema, fixtures and DTOs with no retained consumer are removal targets; Git history and
change-evidence preserve auditability. Compatibility readers may remain only when a current delivery
format still requires them and a focused test proves that need.

## Re-enable Criteria

A frozen lane may return only with all applicable evidence below:

1. A real repeated user workflow demonstrates that the current core path cannot serve the need.
2. Named owner/actor, durable input/output location, and rollback boundary are known.
3. A legal real or de-identified corpus exists for evaluation; synthetic fixtures alone are insufficient.
4. A measurable acceptance target exists (for example, correction rate, review time, or failure rate).
5. The proposed change cannot be handled by a narrower CLI or manual operating step.

## Current Acceptance Boundary

- `repo_supported`: the retained answer generation, reference review and delivery path exist in the repository.
- `workflow_integrated`: 2024/2025 CLI workflow and the current 2024 Visual Audit slice are repository-integrated; this status does not imply semantic acceptance.
- `reference_reviewed`: 2024/2025 corrected deliveries exist.
- `teacher_accepted`: not recorded.
- Frozen readiness, optimization and trust objects do not define current product status.

## Rollback

Rollback each cleanup slice independently through Git. Do not restore frozen code merely to preserve
history, and do not modify user exams, `.env` or real delivery directories as part of rollback.
