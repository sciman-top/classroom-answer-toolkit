# Product Core Simplification Evidence

Date: 2026-07-31

## Scope

This slice reduces the default product to its classroom answer path:

`public or de-identified question -> explicit generation -> answer.md -> PDF/review -> human judgment`

It removes developer review controls from the WPF default surface and replaces the broad strategy
reading order with a small core-first entrypoint. Existing CLI tools, schemas, locks, fixtures, and
regression tests are retained as frozen developer safeguards; no review/trust data is migrated or
deleted.

## Changes

- Removed visible WPF controls for DecisionRecord attachment, aggregate attachment/reverification,
  review-queue projection, and diagnostics export/opening.
- Expanded the activity log into the released right-side work area.
- Added a single core/supported/frozen/re-enable decision and made the strategy README core-first.
- Marked lifecycle writeback, approval/trust actions, queue ownership/persistence, additional
  synthetic/governance expansion, advanced OCR/DOCX, Typst, and multi-VLM work as frozen.

## Verification

| verification | result |
| --- | --- |
| focused `MainWindowXamlContractTests` and `MainViewModelTests` | exit 0; 18 passed; 0 failed |
| native WPF UI Automation | six core generation controls found; six developer review controls absent by accessible name; [native window screenshot](./assets/product-core-simplification/wpf-default-workflow.png) |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings; 0 errors; 2.5 s |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 129 passed; 0 failed; 0 skipped; 1.0 s |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots; 3.0 s |
| `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 970.7 s; toolchain complete |

## Truth Boundary

- This is a default-surface and strategy simplification, not removal of historical evidence tools.
- No lifecycle, approval, trust, queue owner, queue persistence, gateway, workstation, or live state
  was written or upgraded.
- `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`, `eligible=false` remain unchanged.

## Rollback

Revert this atomic commit to restore the previous WPF developer controls and strategy reading order.
No external delivery artifact or user data requires recovery.
