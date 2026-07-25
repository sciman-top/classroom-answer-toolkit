# WPF Review And Trust Projection

## Scope and truth boundary

- task: `REVIEW-003`
- current landing point: the WPF app runs the existing `answer.md -> PDF/review` delivery flow.
- target of this slice: project the latest delivery manifest's review lifecycle, visual-review status, trust status, and JSON `DecisionRecord` reference into WPF.
- write-set: Domain delivery result, local orchestrator manifest reader, MainViewModel, MainWindow XAML, focused tests, README, strategy, backlog, and this evidence.
- exclusions: no AI gateway request change, no cloud egress, no real exam paper, no approval write-back, no review queue, no source-question generation flow, no renderer replacement.

## Behavior and compatibility

- `AnswerDeliveryResult` keeps its existing positional constructor and gains additive init-only review/trust properties.
- missing or malformed review/trust fields remain fail-closed as `visualReviewPassed=null` and `trusted=false`.
- relative `visualDecisionRef` values resolve from the delivery manifest directory.
- the WPF open action accepts only `.json` decision references, preventing the manifest from projecting an executable file into the Shell open path.
- the recent-delivery action area uses wrapping layout so the additional action does not require a single unbounded horizontal row.

## Verification ledger

| Stage | Command or probe | Result |
| --- | --- | --- |
| focused red | orchestrator and MainViewModel tests before implementation | expected compile failures for the missing projection contract |
| focused green | `dotnet test ... --filter "FullyQualifiedName~LocalToolchainOrchestratorTests|FullyQualifiedName~MainViewModelTests"` | exit 0, 7/7 |
| build | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0, 0 warnings, 0 errors |
| test | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0, 58/58 |
| contract | `npm --prefix tools/rule-compiler run validate:assets` | exit 0, 43 assets, 3 subject packs, 3 snapshots |
| cross-subject | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| hotspot | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0, 230.3 seconds |
| AI config | `npm --prefix tools/ai-gateway run validate:config` | exit 0, local config valid, cloud egress disabled |
| WPF smoke | `dotnet run --project src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -c Debug -- --smoke --repository-root D:\CODE\classroom-answer-toolkit` | exit 0, workspace healthy |
| desktop observation | Windows UI Automation read-only state | new review/trust labels and visual-decision action present; no delivery or cloud action invoked |
| hygiene | `git diff --check` and tracked worktree inspection | exit 0; no generated artifact or secret added |

## Toolchain environment note

- repository SDK contract: exact `.NET SDK 10.0.301` with `rollForward=disable`.
- host drift found: system SDKs included `10.0.300` and `10.0.302`, but not `10.0.301`.
- recovery: official `10.0.301` SDK was installed under the task-specific `%TEMP%\classroom-toolkit-dotnet-10.0.301` directory and prepended only to verification process environments.
- repository `global.json` and system SDK installations were not changed.

## N/A: live cloud gateway probes

- reason: this slice does not change `tools/ai-gateway`, provider configuration, request schemas, failover, cloud egress, or vision probe behavior.
- alternative_verification: local AI config validation, six vision contract tests in `check-toolchain`, three visual decision contract tests, and the new .NET fail-closed projection tests.
- evidence_link: `docs/change-evidence/20260725-wpf-review-trust-projection.md`
- expires_at: `2026-08-25`
- recovery_condition: rerun primary, fallback, and forced-primary-failure synthetic-image probes before accepting any later AI gateway, provider config, vision request, or cloud workflow change.

## Completion boundary and rollback

- `repo-side done`: implementation, tests, strategy truth, and local evidence are complete for `REVIEW-003`.
- `gateway verified`: not re-accepted by live probes in this slice; prior gateway acceptance is not promoted by this change.
- `workflow integrated`: partial only, limited to latest-delivery read-only state projection and JSON decision opening.
- `live accepted`: false; no real paper, cloud workflow, teacher approval, or onsite acceptance was performed.
- `still open`: manifest-to-DecisionRecord attachment workflow, full WPF review queue, approval write-back, original-question generation, Track B/C runtime, and live acceptance.
- rollback: revert only the commit containing this slice; no schema migration, external data mutation, or host SDK rollback is required.
