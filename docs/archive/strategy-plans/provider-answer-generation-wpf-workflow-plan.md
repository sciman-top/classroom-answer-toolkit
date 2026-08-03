# Provider Answer Generation WPF Workflow Plan

## Boundary

GEN-005 connects the GEN-004 provider runtime to the WPF shell without combining generation,
delivery, or review approval. Preparing paths is local-only. Provider dispatch occurs only through an
explicit Generate command after cloud-egress consent.

## Workflow

1. The user selects a public `AnswerGenerationRequest`, its workspace root, a local provider config,
   and a new output directory outside repository/workspace authority.
2. The user explicitly enables cloud egress and invokes Generate.
3. WPF passes one `ProviderAnswerGenerationExecutionRequest` to the application orchestrator.
4. The orchestrator validates consent, paths, output nonexistence, and timeout/token bounds before
   invoking GEN-004.
5. After exit zero, the orchestrator independently verifies request/candidate hashes, identity,
   provider provenance, and the fixed pending-review/untrusted disposition.
6. WPF fills the existing answer Markdown, suggested PDF, and subject-pack inputs. Delivery remains a
   separate explicit command.

## Fail-Closed State

- UI command availability and command-body validation both require consent and complete paths.
- The orchestrator repeats consent validation so non-UI callers cannot bypass the boundary.
- A failed or rejected generation clears prior generated-candidate UI state and never starts delivery.
- Generation never writes review approval, lifecycle, delivery trust, readiness, or optimization state.

## Verification And Truth

Local process fakes verify dispatch arguments and postconditions without secrets or network. XAML
contracts verify stable AutomationIds; native Windows observation verifies that the WPF controls load
and remain usable. This is repo-side workflow integration only. Gateway verification, answer quality,
review approval, workstation acceptance, and live acceptance require real authorized evidence.

## Rollback

Rollback the GEN-005 atomic commit. Preserve GEN-004, local `.env`, and external generated outputs.
