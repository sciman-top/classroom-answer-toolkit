# VISION-015 Positive Synthetic Association Evidence

## Goal and authority boundary

- Goal: admit one public deterministic synthetic fixture that produces one honest canonical positive OCR-region association through the existing VISION-007 through VISION-014 chain.
- Result scope: repo-side synthetic diagnostic plumbing only.
- Not claimed: real OCR/region/association precision or recall, layout semantics, `FigureUnderstandingResult`, Track B, delivery trust, WPF workflow integration, gateway live verification, real-data acceptance, or workstation/live acceptance.
- State preserved: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`, `eligible=false`, cloud egress disabled, no `.env` change, no `OptimizationCandidate`.

## Risk-first probe

Two initial renderer variants failed the admission condition and were kept outside canonical authority. The final admitted variant renders a white `80x48` source with a visibly isolated `12` and a separate horizontal baseline; the canonical crop is `160x96`.

The admitted probe produced:

- structure: one line, two connected regions, one text-region candidate;
- OCR: exactly one observation, normalized text `12`, confidence `0.53357305`;
- spatial: exactly one Cartesian pair, intersection area `192`;
- association: exactly one candidate/observation/measurement triple, bidirectionally unique.

No extractor-policy or association-policy case branch was added. The renderer uses the default bitmap font, one horizontal two-pixel dilation, and nearest-neighbor sizing to make a deterministic public synthetic glyph.

## Machine review

- reviewer: `reviewerKind=ai_agent`, `humanReviewed=false`;
- scope: `synthetic_fixture_diagnostic`;
- finding: `12` is legible, the baseline is separated, geometry is undistorted, and the crop is complete;
- preprocessing result SHA-256: `df60fc1e987eefde04acaad038141d16dc29a3d91f971745ffe8e4cfd29ec01e`;
- crop raw SHA-256: `619e236453646fdb4dfb772b3e8ead65e0597c6118af089f731a57cd57633aa6`;
- crop pixel SHA-256: `ac5f2a7abd8ad3aeb98c83ce2db7f9cf2d02b1b7cd357aba0c8323b94b1b01ef`.

## Focused verification

- VISION-007: 13 tests passed; one symlink privilege test skipped; fixture validation passed.
- VISION-008: 12 tests passed; one symlink privilege test skipped; fixture validation passed.
- VISION-009: 20 tests passed; one symlink privilege test skipped; fixture validation passed.
- VISION-010: 15 tests passed; one symlink privilege test skipped; fixture validation passed.
- VISION-011: 18 tests passed; fixture validation passed.
- VISION-012: 21 tests passed; fixture validation passed.
- VISION-013: 19 tests passed; fixture validation passed.
- VISION-014: 16 tests passed; fixture validation passed.
- Asset validation after schema integration: `Validated 151 asset files, 3 subject packs, and 3 snapshots`.

The Windows symlink checks are `platform_na` because the current token lacks symlink creation privilege. Alternative coverage is the packages' canonical path, physical identity, hardlink/alias, path escape, TOCTOU, and staged-tamper tests. Recovery condition: rerun the skipped checks in a Windows process with symlink privilege before any trust expansion; this N/A has no expiry while the host token remains unchanged.

## Authority drift review

The original three source/crop and preprocessing/structure/OCR/spatial/association request/result bytes remain unchanged. The original three VISION-011 truth files legally re-sign because each binds the SHA-256 of the complete current renderer source file, whose definition table now contains the fourth fixture. Inventories and aggregate reports also change to include the fourth case. No claim is made that all original bytes remain unchanged.

The resulting canonical association report contains two unavailable cases, one unmatched case, and one matched case. There are two OCR observations total and one association, so the fixture-level association rate is `0.5`; this is not a production quality metric.

## Repository gate evidence

Final fixed-order verification ran from `D:\CODE\classroom-answer-toolkit` on the same reviewed working tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 151 assets, 3 subject packs, 3 snapshots |
| 4 | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0; snapshot `snapshot-fb15fdf69827ecf1` |
| 5 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 935.4 seconds |

The system `dotnet` lookup initially stopped before MSBuild because `global.json` requires exact SDK `10.0.301` with roll-forward disabled while the system path contains `10.0.300` and `10.0.302`. Verification reused the already prepared `%TEMP%\classroom-toolkit-dotnet-10.0.301` runtime by setting `DOTNET_ROOT` and prepending `PATH` only inside gate command processes. Bootstrap was not run; `global.json` and system SDK installations were not changed.

Two earlier hotspot invocations were externally terminated by command/session limits before the script returned an exit code. They are not treated as verification evidence. The final invocation above ran from the beginning to natural completion and explicitly returned exit code 0.

The hotspot re-ran all eight focused suites and canonical validators. VISION-007 through VISION-014 test counts were 13, 12, 20, 15, 18, 21, 19, and 16 respectively; four existing Windows symlink alias probes were skipped under the N/A record above, while the association suite passed 16/16 with no skip. Gateway template validation allowed missing example secrets, reported cloud egress disabled, and made no live request.

An additional local `npm --prefix tools/ai-gateway run validate:config` probe exited 0, reported cloud egress disabled, and did not print secret values or modify `.env`. This is configuration validation only, not gateway live verification.

## Review and rollback

Five-axis review covered correctness, readability, architecture, security, and performance; no unresolved blocking or required issue remained. The atomic implementation and strategy commit is `329b623`. Rollback reverts the VISION-015 evidence and implementation commits, removing the fourth fixture and aggregate increments while restoring renderer-bound truths and schemas; it does not modify `.env`, OCR environments, gateway configuration, delivery/review authority, readiness receipts, or existing sample authority.
