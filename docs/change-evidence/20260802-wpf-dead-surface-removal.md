# 2026-08-02 WPF and .NET dead-surface removal evidence

## Scope

- Removed the empty `ClassroomToolkit.Interop` project from the solution and deleted its template class/project file.
- Removed unconsumed ReviewQueue, VisualDecision attachment, and DeliveryDecisionAggregate attachment DTO families.
- Removed the unregistered `WorkspaceDiagnosticsExporter` service, its interface, and its DI extension.
- Replaced the stale published-app smoke contract with the fields actually emitted by `App --smoke`: workspace health, subject packs, snapshot, and eval status.
- Removed MSIX packaging dependency on a diagnostics manifest that the application never emitted.

## Consumer proof

- No project referenced `ClassroomToolkit.Interop`.
- The removed domain records referenced only other records within the same dead type families.
- No production registration or caller consumed `IWorkspaceDiagnosticsExporter`; its extension method was also unused.
- XAML and `MainViewModel` already expose only answer delivery, status, and artifact-open commands; this slice did not modify visible UI.

## Runtime drift found and fixed

- The first published headless smoke correctly failed because `eval/junior-physics-answer/dataset.json` still declared v8.14 while the manifest/snapshot declared v8.15.
- Updated dataset asset versions to junior physics v8.15, senior physics v1.1, and math v0.2.
- Re-ran Core for junior physics to regenerate `latest.json`; the next published smoke reported `workspaceHealthy=True`, `evalOk=True`, and 14 eval cases.

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| PowerShell parser over publish/smoke/package scripts | exit 0 | no parse errors |
| `dotnet build ClassroomToolkit.sln -c Debug -p:UseSharedCompilation=false` | exit 0 | five production projects plus tests; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0 | 46/46 passed |
| `scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0 | 12 schemas and 14 eval cases; 65.31 s |
| `scripts/publish-app.ps1` | exit 0 | publish succeeded; hidden `--smoke` succeeded; report written under `artifacts/publish/verification/` |

## UI and acceptance boundary

- No XAML or visible WPF behavior changed, so no desktop window or coordinate-based UI automation was required.
- The short-lived published `--smoke` process ran hidden and shut down normally.
- This proves the local WPF shell can load current workspace/subject-pack/snapshot/eval state; it does not prove classroom usability or teacher acceptance.
- No provider call, `.env` mutation, user-exam mutation, or delivery-asset mutation occurred.

## Rollback

- Restore the Interop project block/files, dead DTOs, old diagnostics exporter, and old smoke/package contracts together.
- If reverting dataset versions, also revert the matching subject-pack/spec versions and regenerate eval results; do not create a version mismatch intentionally.
