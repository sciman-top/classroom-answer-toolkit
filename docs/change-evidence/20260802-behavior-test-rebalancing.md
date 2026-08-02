# 2026-08-02 behavior-test rebalancing evidence

## Scope

- Removed C# tests that asserted JavaScript, PowerShell, and XAML implementation strings for snapshot runtime, gate routing, publish smoke, and packaging internals.
- Kept manifest/spec byte alignment, SDK JSON, and a small frozen-entrypoint prohibition scan as structural contracts.
- Added CLI behavior tests that execute the real snapshot compiler, Fast toolchain gate, unknown subject-pack rejection, and missing published-executable rejection.
- Added a WorkspaceHealthReportReader behavior test for eval/manifest version drift.

## Behavioral coverage

- Snapshot success path parses the generated JSON and verifies snapshot id, subject pack, version, and active profile.
- Snapshot negative path proves an unknown subject pack returns non-zero.
- Fast gate test proves the actual CLI executes spec/AI steps and skips Core work.
- Published smoke negative path proves the script fails closed when the executable is missing.
- Eval drift test proves v10.9 results cannot be reported healthy against a v11.0 manifest.
- Existing Node tests remain the authority for answer-request, visual-audit, fallback, normalization, and diff behavior.
- Existing MainViewModel tests remain the authority for delivery commands and artifact-open behavior.

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug -p:UseSharedCompilation=false` | exit 0 | 0 warnings, 0 errors |
| full xUnit suite | exit 0 | 33/33 passed; CLI behavior tests included; about 4 s |
| filtered eval-version-drift test | exit 0 | 1/1 passed |
| `scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0 | Core completed in 62.26 s |

## Verification correction

- An initial filtered run used `--no-build` before the new test had been compiled and reported no matching tests.
- That output was not counted as evidence. A fresh build followed by the 33-test suite and the filtered 1-test run supplied the completion evidence above.

## Truth boundary

- This proves automated behavior contracts, not native visible WPF interaction or teacher acceptance.
- The suite intentionally avoids introducing a general UI E2E framework.
- No cloud/provider request or user-asset mutation occurred.

## Rollback

- Restore the removed source-string contract test files and remove `ToolchainCliBehaviorTests.cs` plus the eval drift test.
- Do not remove the CLI behavior tests while keeping completion claims that depend on them.
