# GEN-005 WPF Provider Workflow Evidence

Date: 2026-07-31

## Scope

GEN-005 connects the GEN-004 public-data provider runtime to the WPF shell. Users explicitly select
the request, workspace root, provider config, and a new external output directory, then separately
authorize cloud egress. Successful generation fills the existing delivery input; it does not start
PDF/review delivery or change review/trust state.

## Test-First Evidence

The first focused run exposed ambiguous WPF/WinForms `OpenFileDialog` resolution and was repaired by
binding the new dialogs to `Microsoft.Win32`. The next compile exposed a test fake that needed the
additive orchestrator method. The first behavior run passed 61/62 and proved `CanExecute` alone was
not an authorization boundary because direct command execution could bypass it; command-body
consent validation was added, then the focused suite passed 62/62.

## Five-Axis Review

1. Functional: explicit Generate calls GEN-004 and fills Markdown/PDF/subject-pack inputs; delivery is
   still a separate command.
2. Contract: additive execution request/result and toolchain kind keep provider generation separate
   from `AnswerDeliveryRequest` and review contracts.
3. Security: UI and orchestrator both require consent; orchestrator validates request/workspace,
   config, new external output, timeout/token bounds, request/candidate hashes, identity, provenance,
   and fail-closed disposition.
4. Compatibility: existing offline Markdown delivery remains available without provider config or
   consent; existing GEN-003/004 schema/runtime bytes are unchanged.
5. Truth: local fakes prove repo-side workflow plumbing only. No real credential, network, provider
   answer, teacher approval, workstation acceptance, or live acceptance is claimed.

## Verification

| verification | result |
| --- | --- |
| focused WPF/orchestrator tests | exit 0; 62 passed; 0 failed |
| native WPF observation | Windows UI Automation found 9 new controls with names/AutomationIds; Generate was disabled before consent and enabled after path entry + explicit consent; [screenshot](./assets/gen005/wpf-provider-workflow.png) |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings; 0 errors; 2.4 s |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 129 passed; 0 failed; 0 skipped; 1.0 s |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots; 4.0 s |
| `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 1048.7 s; toolchain complete |

## Acceptance Boundary

- `repo-side done`: implementation, native observation, fixed gates, and the atomic commit containing this record are complete.
- `workflow integrated`: repo-side yes after successful fixed gates; provider generation is reachable
  from WPF and feeds the delivery input, while delivery remains explicit.
- `gateway verified`: no; no real provider observation exists.
- `workstation accepted`: no; local native observation is not user acceptance.
- `live accepted`: no.
- review/trust: generation remains `pending_review / trusted=false`; delivery trust is untouched.
- readiness: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`,
  `eligible=false`; no `OptimizationCandidate` is generated.

## Rollback

Rollback the GEN-005 atomic commit. Preserve GEN-004, `.env`, and external user output directories.
