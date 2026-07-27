# REVIEW-009 Read-only Review Queue Evidence

## Goal and boundary

- landing point before this slice: WPF could attach and immediately reverify an existing local delivery aggregate, but it had no aggregate view across the three human queues.
- target: project explicitly selected, locally reverified review artifacts into `needs_human_label`, `high_risk_approval`, and `truth_needs_review` without creating new authority.
- inputs: existing canonical synthetic `FeedbackParseResult`, source-recomputed `DecisionRecord`, and source-aware `DeliveryDecisionAggregate` contracts.
- excluded: approval generation, lifecycle transition, trust mutation, `OptimizationCandidate`, real teacher/student/paper data, default answer-generation workflow, cloud egress, and live acceptance.

## Implemented contract

- `ReviewQueueProjectionRequest / ReviewQueueProjectionResult / ReviewQueueItem` are provider-neutral Domain contracts and remain separate from `AnswerDeliveryRequest`.
- the Node projector accepts only explicit `--artifact` inputs; it does not scan a directory or silently admit unknown JSON.
- selected sources are canonicalized and bound to raw-byte SHA-256; duplicate canonical paths and duplicate `stat.dev/stat.ino` identities fail closed.
- canonical synthetic teacher feedback is replayed through the existing teacher authority; DecisionRecord is recompiled from unique sibling evidence/track sources; aggregate is recomputed through the existing source-aware verifier.
- DecisionRecord verification tries both `humanApproved=false` and `humanApproved=true` and requires exactly one complete contract match. This preserves a legal human-approved record that remains blocked by high-risk gates.
- one rejected source clears all items and counts. The .NET adapter strictly parses the JSON result, rejects duplicate item source paths, and rehashes selected artifact bytes before returning the time-point projection.
- WPF explicitly multi-selects JSON, shows all three counts, source path, raw-byte SHA-256, reason, and a read-only local open action.
- projection authority is exactly `local_verified_projection`; it is not an approval or trust credential.

## Focused verification

| Check | Result |
| --- | --- |
| review queue Node contracts | 6 passed, including all three queues, input-order independence, human-approved-but-blocked, malformed/unknown/drift, duplicate path, and physical hardlink alias |
| WPF/orchestrator focused .NET tests | passed; included real Node integration, rejected projection, stale-state clearing, open-source action, and XAML SourcePath/SHA-256 bindings |
| WPF headless smoke | exit 0; workspace healthy; no review source, approval, trust, or cloud action invoked |
| native WPF observation | `复核队列`, count summary, `投影来源`, and disabled-without-selection `打开来源` located by PID-scoped UI Automation |
| native WPF capture | `artifacts/review-queue-observation/review-queue-window.png`; local ignored evidence, captured directly from the task-owned HWND with `PrintWindow` |
| independent reviewer | final `APPROVE`; 0 Critical, 0 Required after two review rounds |

The first review found three real gaps and they were closed before the final gates:

1. human approval was initially inferred from `visualReviewPassed`; replaced with unique false/true recompilation.
2. WPF initially omitted source path/hash; both are now displayed and contract-tested.
3. the new shared schema was initially absent from `validate:assets`; it is now in the explicit schema list.

## Final fixed-order gates

Executed from `D:\CODE\classroom-answer-toolkit` with the repository-pinned local .NET SDK `10.0.301` first on `PATH`.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 91 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; `Toolchain check complete` |

Hotspot details:

- gateway config template: valid with cloud egress disabled and missing synthetic/example keys explicitly allowed.
- gateway synthetic vision contracts: 6/6.
- visual DecisionRecord: 14/14.
- visual-risk diagnostic: 12/12.
- delivery aggregate: 59/59.
- review queue: 6/6.
- sample flywheel: 72 passed, 1 capability skip (`EPERM` symlink creation).
- synthetic answer generator: 8/8.
- six subject/profile snapshots, cross-subject, Chromium renderer smoke, all three subject eval sets, and OCR imports passed.

The hotspot was first wrapped with 120-second and 300-second command limits. Both wrappers terminated the otherwise progressing gate; the second reached the final OCR stage and broke its stdout pipe. A direct OCR import probe passed in 0.37 seconds. The unchanged hotspot command then completed with exit 0 under a 600-second wrapper in 305.4 seconds. No product or environment fix was needed.

## N/A record

- item: answer-graphics smoke in the hotspot script
- classification: `gate_na`
- reason: `answer-graphics` remains an explicitly experimental surface and is not part of the default product gate for REVIEW-009.
- alternative_verification: workspace health and existing asset validation continue to detect the experimental controlled-graphic artifacts; REVIEW-009 does not modify that tool or contract.
- evidence_link: this document and the final `check-toolchain.ps1` output line `answer graphics smoke: skipped (experimental, not part of default toolchain gate)`.
- expires_at: when answer-graphics is promoted into the default delivery contract, or when a slice changes its code/schema/runtime, whichever occurs first.
- recovery_condition: add and execute the repository-approved answer-graphics smoke in the fixed hotspot order before accepting that future slice.

## Residual risk and rollback

- this is an immediate local projection. Node source-aware recomputation and the selected artifact rehash establish a point-in-time result, but the projection is not persisted. If it later drives approval or becomes positive authority, every sibling/transitive source path/hash must be returned and reverified by the .NET consumer.
- `LocalToolchainOrchestrator` is large; extracting the strict review queue stdout parser is a future maintainability slice, not a correctness blocker here.
- rollback is code-only: revert the REVIEW-009 implementation commit and remove its schema/tool/tests/docs. No source artifact, delivery manifest, receipt, lifecycle, trust field, `.env`, or external data requires restoration.

## Acceptance boundary

- `repo-side done`: yes for REVIEW-009 implementation, independent review, focused tests, native WPF observation, full fixed-order gates, evidence, and rollback definition. Commit/push parity is recorded after closeout.
- `gateway verified`: config template and synthetic request/failover/vision contracts only. No live provider or cloud request was executed.
- `workflow integrated`: partial only. Explicit local read-only queue projection is integrated into WPF; default original-question generation, aggregate generation, approval creation/write-back, and lifecycle advancement are not integrated.
- `live accepted`: no.
- `readiness controls`: unchanged; `toolchain_not_verified` and `restricted_egress_not_verified` remain in the canonical readiness report, `eligible=false`, and `optimizationCandidateRefs=[]`.
- `still open`: approval/lifecycle workflow, full operational queue persistence/ownership, real controlled data acceptance, Track A/B/C default runtime, local high-resolution crop/multiscale preprocessing, Typst adapter/parity runtime, attested controls, live gateway verification, and workstation/live acceptance.
