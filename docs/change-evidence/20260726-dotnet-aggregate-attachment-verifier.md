# REVIEW-006 .NET Aggregate Attachment Verifier Evidence

## Goal and boundary

- current landing point: `REVIEW-005` provides a controlled aggregate attachment and read-only Node verifier; .NET consumers clamp every aggregate attachment to `visualReviewPassed=null / trusted=false`.
- target landing point: expose the existing verifier as an explicit, read-only, typed .NET orchestration capability before any positive WPF projection.
- excluded: WPF aggregate attachment, automatic verification in read paths, approval generation, lifecycle transition, cloud egress, real papers, and live acceptance.

## Changes

- added typed request, verification credential, and execution result records.
- added `IToolchainOrchestrator.VerifyDeliveryDecisionAggregateAttachmentAsync`.
- invoked the existing verifier `.mjs` directly through `node` so the production `UseShellExecute=false` runner does not depend on Windows `npm.cmd` shell resolution.
- converted non-cancellation process-start and process-run exceptions into typed fail-closed results; cancellation still propagates.
- validated kind, requested manifest correlation, absolute artifact paths, non-empty attachment id, SHA-256 digests, and positive review/trust fields.
- retained the existing fail-closed behavior in `ReadDeliveryContext`, WPF, diagnostics, and headless smoke.

## Increment evidence

| Check | Result |
| --- | --- |
| focused orchestrator tests after contract implementation | 21/21 passed |
| real synthetic shell attach and verify probe | exit 0; both commands emitted the expected structured attachment credential |
| focused orchestrator plus real process integration after review fix | 31/31 passed |
| real `.NET PowerShellProcessRunner -> node -> synthetic fixture` integration | passed inside the focused xUnit run |
| synthetic probe cleanup | temporary workspace removed |

## Toolchain environment

- repository SDK contract: exact `.NET SDK 10.0.301` with `rollForward=disable`.
- host system SDK list does not include `10.0.301`.
- verification uses the existing task-local `%TEMP%\classroom-toolkit-dotnet-10.0.301` installation by prepending `DOTNET_ROOT/PATH` only for command processes.
- `global.json`, system SDK installations, and bootstrap state are unchanged.

## N/A: live cloud gateway probes

- reason: this slice does not change `tools/ai-gateway`, provider configuration, request schemas, failover, cloud egress, or vision request behavior.
- alternative_verification: run `npm --prefix tools/ai-gateway run validate:config` and the complete local hotspot gate.
- evidence_link: this file and the final gate table below.
- expires_at: 2026-08-26, or earlier when gateway/provider behavior changes.
- recovery_condition: enable cloud egress explicitly and run primary, backup, and forced-primary-failure probes with synthetic or redacted images.

## Final gates

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 93/93 passed, 0 skipped |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 47 assets, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; cross-subject contract passed |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; gateway vision 6/6, visual decision 11/11, aggregate 59/59, renderer/eval/OCR hotspots passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid, cloud egress disabled |
| `git diff --check` | exit 0 |
| secret and `.env` hygiene | no key pattern in diff; `.env` ignored and untracked; only safe `.env.example` tracked |
| manifest lock residue | 0 adjacent canonical locks; 0 physical locks |
| independent read-only review | first round found Windows bare-`npm` process-start P1; direct-`node` fix and real process integration accepted in second round |

## Acceptance boundary

- `repo-side done`: implementation and gates complete; commit/push projection pending at evidence capture.
- `gateway verified`: not re-accepted by live probes in this slice.
- `workflow integrated`: false; the adapter is explicit and no WPF or automatic read path consumes a positive credential.
- `live accepted`: false.
- `still open`: verified positive WPF projection, WPF aggregate attachment, approval/lifecycle workflow, real-paper inventory, original-question generation, Track B/C runtime, and live acceptance.
- rollback: revert only the commit containing `REVIEW-006`; the capability is read-only and created no persistent delivery mutation.
