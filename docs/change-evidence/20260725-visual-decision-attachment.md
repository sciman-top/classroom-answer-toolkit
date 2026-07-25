# Visual Decision Attachment

## Scope and truth boundary

- task: `REVIEW-004`
- current landing point: `REVIEW-003` projects the latest delivery manifest review/trust state into WPF.
- target of this slice: attach an existing local JSON `DecisionRecord` through a fail-closed repo tool and refresh WPF from the updated delivery manifest.
- write-set: visual-evidence tool/tests, Domain/Application/Services orchestration contract, WPF ViewModel/XAML, focused tests, README/strategy/backlog, and this evidence.
- exclusions: no DecisionRecord generation in WPF, no approval action, no lifecycle advancement, no review queue, no cloud egress, no real exam paper, no renderer migration, no source-question generation workflow.

## Behavior and rollback

- both JSON inputs are schema-validated and must carry the same `subjectPack`.
- top-level DecisionRecord trust fields must match `statusProjection`; unsafe trust/review combinations fail closed.
- positive `visualReviewPassed/trusted` projection is blocked until a delivery-level aggregate proves snapshot binding and complete question coverage.
- the tool updates only `review.visualDecisionRef`, `status.visualReviewPassed`, and `status.trusted`.
- every mutation atomically refreshes `<manifest>.before-visual-decision.json` to the current direct preimage; manifest replacement uses a sibling temporary file and atomic rename.
- repeating the same attachment is an idempotent no-op.
- WPF invokes the tool through `IToolchainOrchestrator` and rereads the manifest after success.
- the orchestrator verifies the reread decision path and status projection before reporting success to WPF.

## Verification ledger

| Stage | Command or probe | Result |
| --- | --- | --- |
| focused red | `npm --prefix tools/visual-evidence run test:decision` before adapter implementation | expected `ERR_MODULE_NOT_FOUND` for `attach-decision.mjs` |
| Node focused green | `npm --prefix tools/visual-evidence run test:decision` | exit 0, 9/9 |
| .NET focused green | orchestrator and MainViewModel filtered tests | exit 0, 12/12 |
| synthetic CLI | `npm --prefix tools/visual-evidence run attach:decision -- --manifest <synthetic> --decision <synthetic>` | exit 0, `changed=true`, fail-closed projection preserved, direct-preimage backup exists |
| desktop observation | native WPF launch plus Windows UI Automation | `关联视觉决策` exists and is disabled without a local manifest; no delivery, attachment, or cloud action invoked |
| WPF headless smoke | `dotnet run --project src/ClassroomToolkit.App/ClassroomToolkit.App.csproj -c Debug -- --smoke --repository-root D:\CODE\classroom-answer-toolkit` | exit 0, workspace healthy, diagnostic manifest exported |
| build | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0, 0 warnings, 0 errors |
| test | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0, 63/63 |
| contract | `npm --prefix tools/rule-compiler run validate:assets` | exit 0, 43 assets, 3 subject packs, 3 snapshots |
| cross-subject | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| hotspot | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0, 222.5 seconds; visual-evidence 9/9 and vision contract 6/6 |
| AI config | `npm --prefix tools/ai-gateway run validate:config` | exit 0, local config valid, cloud egress disabled |
| independent review | read-only explorer review and post-fix review | three required findings fixed; no remaining required code finding |
| hygiene | `git diff --check`, secret scan, and tracked worktree inspection | exit 0; no generated artifact or secret added |

## Toolchain environment note

- repository SDK contract: exact `.NET SDK 10.0.301` with `rollForward=disable`.
- host system SDKs do not include that exact version.
- verification prepends the existing task-local `%TEMP%\classroom-toolkit-dotnet-10.0.301` SDK only to command environments.
- `global.json` and system SDK installations are unchanged.

## N/A: live cloud gateway probes

- reason: this slice does not change `tools/ai-gateway`, provider configuration, visual request payloads, failover, cloud egress, or gateway runtime behavior.
- alternative_verification: local AI config validation, visual gateway contract tests in `check-toolchain`, synthetic DecisionRecord attachment tests, and .NET fail-closed orchestration tests.
- evidence_link: `docs/change-evidence/20260725-visual-decision-attachment.md`
- expires_at: `2026-08-25`
- recovery_condition: rerun primary, fallback, and forced-primary-failure synthetic-image probes before accepting any later gateway, provider config, vision request, or cloud workflow change.

## Completion boundary

- `repo-side done`: implementation, truth documents, focused verification, full gates, and review are complete for `REVIEW-004`.
- `gateway verified`: no new live verification in this slice.
- `workflow integrated`: partial, limited to existing local DecisionRecord attachment and WPF manifest refresh.
- `live accepted`: false.
- `still open`: complete review queue, approval generation/write-back, original-question generation, Track B/C runtime, default multimodal answering integration, and live acceptance.
