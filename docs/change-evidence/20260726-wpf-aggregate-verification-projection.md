# REVIEW-007 WPF Aggregate Verification Projection Evidence

## Goal and boundary

- current landing point: REVIEW-006 exposes a typed, read-only aggregate attachment verifier, but no WPF command consumes a positive result.
- target landing point: let the user explicitly reverify the latest delivery manifest and project only a `manifestResultSha256`-bound point-in-time result.
- excluded: automatic verification, aggregate attachment from WPF, approval generation, lifecycle transition, diagnostics/headless positive projection, cloud egress, real papers, and live acceptance.

## Behavior

- the orchestrator reads manifest bytes after Node verification, recomputes SHA-256, and rejects any mismatch with `manifestResultSha256`.
- the positive `AnswerDeliveryResult` is parsed from those same verified bytes rather than from a later file read.
- WPF clamps visual-review/trust before each attempt and retains fail-closed state on process, contract, hash, or projection failure.
- successful WPF projection displays the verification state and verified manifest result hash.
- ordinary delivery and question-level decision attachment clear prior aggregate verification state.
- diagnostics, headless smoke, and ordinary delivery reads remain fail-closed for every aggregate attachment.

## Increment evidence

| Check | Result |
| --- | --- |
| focused .NET regression (`MainViewModel / orchestrator / real Node integration / headless / diagnostics`) | 55/55 passed after review fixes on 2026-07-26 |
| manifest drift regression | verifier output is rejected when manifest bytes change before .NET projection |
| real Node integration | attached synthetic fixture returns a trusted delivery snapshot from verified bytes |
| native WPF UI Automation | `ClassroomToolkit` window opened; `重验聚合凭据` button and both aggregate status labels found; button disabled without a manifest; no action invoked; window closed normally |
| WPF headless smoke | exit 0; workspace healthy; diagnostics exported; aggregate attachment was not positively projected |

## N/A: live cloud gateway probes

- reason: this slice changes only local verifier consumption and WPF state projection; gateway config, provider routing, request schemas, failover, and cloud egress are unchanged.
- alternative_verification: AI config validation, gateway vision contract tests, synthetic local aggregate fixture, and full hotspot gate.
- evidence_link: this file and its final gate table.
- expires_at: 2026-08-26, or earlier when gateway/provider behavior changes.
- recovery_condition: explicitly enable cloud egress and run primary, backup, and forced-primary-failure probes with synthetic or redacted images.

## Final gates

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 98/98 passed, 0 skipped |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 47 assets, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; cross-subject contract passed |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; gateway vision 6/6, visual decision 11/11, aggregate 59/59, renderer/eval/OCR hotspots passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid, cloud egress disabled |
| `git diff --check` | exit 0 |
| secret and `.env` hygiene | no key pattern in diff; `.env` ignored and untracked; only safe `.env.example` tracked |
| manifest lock residue | 0 adjacent canonical locks; 0 physical locks |
| independent read-only review | two rounds; test/evidence gaps corrected; no code or trust-boundary blocker remained |

## Residual risk

- the positive projection is a point-in-time statement tied to the displayed manifest result hash, not a long-lived capability token.
- source artifacts can change after Node verification; no downstream approval, publication, or delivery action consumes this projection. Any future effectful consumer must reverify all sources and bind the current manifest hash at action time.
- external manifest changes after a successful command do not automatically revoke the visible WPF state. The displayed hash makes that boundary inspectable; ordinary refresh paths remain fail-closed.

## Acceptance boundary

- `repo-side done`: implementation, review, and gates complete; commit/push projection pending at evidence capture.
- `gateway verified`: no new live gateway acceptance in this slice.
- `workflow integrated`: partial only; explicit WPF verification projection is integrated, but aggregate attachment, approval, lifecycle, and original-question workflow are not.
- `live accepted`: false.
- `still open`: WPF aggregate attachment, approval/lifecycle workflow, real-paper inventory, original-question generation, Track B/C runtime, and live acceptance.
- rollback: revert only the REVIEW-007 commit; the new path is read-only and creates no delivery mutation.
