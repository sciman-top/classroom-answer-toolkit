# Delivery Decision Aggregate

## Scope and truth boundary

- task: `VISION-006`
- current landing point: question-level DecisionRecord can be compiled and attached fail-closed, while current attach/WPF rejects positive trust.
- target of this slice: prove delivery-level snapshot/input/manifest binding and exact per-question coverage in an offline aggregate.
- write-set: shared schemas, visual-evidence compiler/tests, synthetic eval fixture, rule compiler registration, hotspot, strategy/backlog/README, and this evidence.
- exclusions: no WPF/.NET orchestration change, no aggregate manifest attachment, no lifecycle advancement, no cloud request, no real exam paper, no original-question inventory generator, no live acceptance.

## Contract and behavior

- `DeliveryQuestionCoverage` binds a schema-valid `sample-package.expectedQuestionRefs` inventory to `snapshotId`, snapshot bytes, delivery input bytes, and manifest bytes.
- `DecisionRecord.deliveryBinding` is additive and propagated from `ProblemEvidenceBundle.deliveryBinding`.
- question refs use trim plus exact matching; there is no guessed case, punctuation, or numbering normalization.
- duplicate, extra, empty, or mismatched question refs are rejected.
- hash drift, subject mismatch, snapshot mismatch, missing binding, or inventory mismatch are rejected.
- positive DecisionRecord acceptance uses a strict reason allowlist, requires `evidence_chain_complete` and `human_approved`, non-empty evidence/track refs, and no conflicts; every other reason remains fail-closed.
- aggregate `trusted=true` requires complete coverage, every decision accepted, canonical manifest semantics, real output/review artifact file types, manifest toolchain/delivery/review-artifact gates true, and lifecycle `approved` or `published`.
- the compiler reads each JSON artifact and its digest from the same bytes, then writes only an aggregate artifact through sibling-temp atomic replacement.
- the source-aware verifier rehashes and recomputes the aggregate, rejects source drift and forged zero-decision trust, and compares schema-owned fields without rejecting additive extensions or property reordering.

## Verification ledger

| Stage | Command or probe | Result |
| --- | --- | --- |
| aggregate focused | `npm --prefix tools/visual-evidence run test:aggregate` | exit 0, 40/40 |
| visual-evidence all | `npm --prefix tools/visual-evidence run test` | exit 0, 50/50 |
| asset contract | `npm --prefix tools/rule-compiler run validate:assets` | exit 0, 47 assets, 3 subject packs, 3 snapshots |
| cross-subject focused | filtered `CrossSubjectContractTests` | exit 0, 16/16 |
| build | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0, 0 warnings, 0 errors |
| test | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0, 63/63 |
| cross-subject | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| hotspot | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; aggregate 40/40, gateway vision contract 6/6, renderer/eval/OCR passed |
| AI config | `npm --prefix tools/ai-gateway run validate:config` | exit 0; local primary/fallback keys configured, cloud egress disabled |
| independent review | read-only review, four rounds | final Approve; no High/Medium required finding |
| hygiene | `git diff --check` plus tracked fixture byte-stability test | exit 0 |

## N/A: live cloud gateway probes

- reason: this slice changes only offline schemas, local hashing, aggregate compilation, synthetic eval fixtures, and contract gates; it does not change AI gateway configuration, requests, failover, cloud egress, or provider behavior.
- alternative_verification: local AI config validation, gateway contract tests inside `check-toolchain`, aggregate hash-drift tests, and synthetic/de-identified fixtures.
- evidence_link: `docs/change-evidence/20260725-delivery-decision-aggregate.md`
- expires_at: `2026-08-25`
- recovery_condition: rerun primary, fallback, and forced-primary-failure synthetic-image probes before accepting any later gateway/provider/request or cloud-workflow change.

## Completion boundary and rollback

- `repo-side done`: implementation, review, evidence, and full gates complete; commit/push is the remaining Git projection action.
- `gateway verified`: no new live verification in this slice.
- `workflow integrated`: false for aggregate; compiler capability only.
- `live accepted`: false.
- `still open`: real question-inventory generation, aggregate attachment, WPF positive trust projection, approval write-back, complete review queue, Track B/C runtime, and onsite acceptance.
- rollback: revert only this slice; no manifest, external data, provider, or host state migration is required.
