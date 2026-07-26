# REVIEW-008 WPF Aggregate Attachment Workflow Evidence

## Goal and boundary

- current landing point: WPF can explicitly reverify an already attached aggregate, but cannot initiate the controlled attachment.
- target landing point: let the user select an existing local `DeliveryDecisionAggregate`, invoke the repository-owned attachment tool, immediately run the source-aware verifier, and project only the hash-bound result.
- excluded: aggregate generation, approval generation, lifecycle transition, automatic verification, diagnostics/headless positive projection, cloud egress, real papers, original-question solving, and live acceptance.

## Behavior

- Domain/Application expose an explicit aggregate attachment request and a two-stage result.
- orchestration invokes the existing attach CLI directly with `node`; a failed attachment never starts the verifier.
- a pre-canceled request starts no process; cancellation after attachment prevents the verifier from starting and leaves the mutated manifest untrusted to the WPF caller until an explicit reverify succeeds.
- a successful attachment is not enough for WPF trust: source-aware reverification must also succeed and return a delivery projection bound to the current `manifestResultSha256`.
- WPF clamps stale visual-review, trust, verification status, and hash before the effectful action; attach, verify, or exception failures remain fail-closed.
- the existing manifest writer lock, preimage backup, receipt, source snapshot checks, and post-write rollback remain the authority for mutation safety.

## Increment evidence

| Check | Result |
| --- | --- |
| focused .NET regression (`MainViewModel / orchestrator / real Node integration / process runner`) | 55/55 passed on 2026-07-26 after review fixes |
| real Node integration | synthetic fixture completed `attach -> source-aware verify -> trusted hash-bound delivery projection` |
| attachment failure boundary | verifier is not invoked after attach process failure |
| post-attachment verification boundary | attach success with verifier failure returns no credential or delivery projection |
| native WPF UI Automation | `ClassroomToolkit` window opened; `关联聚合凭据` and `重验聚合凭据` were found and disabled without a manifest; aggregate status labels were found; no action was invoked; window closed with exit 0 |
| WPF headless smoke | exit 0; workspace healthy; diagnostics exported; no aggregate positive projection occurred |

## Final gates

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 114/114 passed, 0 skipped |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 47 assets, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; cross-subject contract passed |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; gateway vision 6/6, visual decision 11/11, aggregate 59/59, renderer/eval/OCR hotspots passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid, cloud egress disabled |
| native WPF UI Automation | exit 0; both aggregate controls present and disabled without a manifest; no effectful command invoked |
| WPF headless smoke | exit 0; workspace healthy; diagnostics exported; no positive aggregate projection |
| independent read-only review | two rounds; cancellation, result-contract, rollback, and evidence findings addressed; no blocker remains |

## N/A: live cloud gateway probes

- reason: this slice changes only local aggregate attachment/reverification and WPF projection; gateway config, provider routing, request schemas, failover, and cloud egress are unchanged.
- alternative_verification: AI config validation, gateway vision contract tests, synthetic local aggregate fixture, and full hotspot gate.
- evidence_link: this file and its final gate table.
- expires_at: 2026-08-26, or earlier when gateway/provider behavior changes.
- recovery_condition: explicitly enable cloud egress and run primary, backup, and forced-primary-failure probes with synthetic or redacted images.

## Residual risk

- attachment mutates the selected delivery manifest and creates/refreshes its preimage backup and receipt; the UI does not automate rollback.
- the positive projection remains a point-in-time statement tied to the displayed manifest result hash.
- external source or manifest changes after success do not automatically revoke visible WPF state.
- no approval, publication, or other downstream effectful consumer accepts this state.

## Acceptance boundary

- `repo-side done`: implementation, review, focused regression, native WPF observation, headless smoke, and full gates complete; commit and push remain pending at this evidence capture.
- `gateway verified`: no new live gateway acceptance in this slice.
- `workflow integrated`: partial only; local aggregate attachment and immediate reverification are integrated into WPF, but aggregate generation, approval/lifecycle, original-question solving, and cloud visual routing are not.
- `live accepted`: false.
- `still open`: review queues and approval/lifecycle workflow, real-paper inventory, original-question generation, Track B/C runtime, gateway main-flow integration, and live acceptance.
- rollback: revert only the REVIEW-008 commit. For a manifest already mutated by the command, preserve current manifest/receipt/backup, reverify the hash chain, require current manifest SHA-256 to equal receipt `manifestResultSha256`, then acquire the same canonical/physical locks and atomically restore the preimage before handling the receipt. Hash drift or uncertain lock ownership requires manual reconciliation; never overwrite later valid writer updates.
