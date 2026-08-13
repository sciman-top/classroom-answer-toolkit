# 2026-08-13 fixed AI solving tier

## Scope and decision

- Defined AI solving as the initial blind answer generation stage (`blind_generation`).
- Fixed that stage to `gpt-5.6-sol/xhigh` for every input size and declared risk level.
- Filtered the executable provider set by actual model and reasoning fields, not only by the configured role name.
- Disabled lower-tier fallback for blind solving. If no matching provider exists, or the matching request fails, the stage fails closed.
- Kept visual audit, findings extraction/merge, and reference review on their existing task-specific routes.

## Correctness boundary

- The fixed tier prioritizes flagship capability and higher reasoning effort, but it does not guarantee semantic correctness.
- Visual audit, deterministic validators, authoritative reference review, real-paper regression, and teacher acceptance remain separate controls.
- No live provider request was made. Cloud egress remained disabled.
- Existing 2024/2025 `sol/medium` artifacts remain historical baselines; this change does not relabel them as `sol/xhigh` results.

## Verification

| Command | Result |
| --- | --- |
| `npm --prefix tools/ai-gateway run test:answer` | exit 0; 25/25 passed, including fixed-tier selection and retryable-failure fail-closed behavior |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local primary resolves to `gpt-5.6-sol/xhigh`; cloud egress disabled |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0; 34/34 passed |
| `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0; Core complete in 46.51 s; 14 answer eval cases passed |

## Rollback

- Revert the fixed blind-generation provider filter, its tests, the strategy text, this evidence file, and the ROUTE-102 ledger row as one slice.
- Do not modify `.env`, authority PDFs, historical delivery artifacts, or their recorded model provenance.
