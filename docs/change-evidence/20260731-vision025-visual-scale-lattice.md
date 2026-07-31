# VISION-025 Visual Scale Lattice Evidence

Date: 2026-07-31

## Scope

VISION-025 adds a deterministic public synthetic compiler that binds an independent scale-lattice
declaration to current VISION-024 component semantics and VISION-008 structure geometry. It derives
relative pointer subdivision index 11 without generating a physical quantity, unit, reading, question
binding, answer, provider result, or cloud request.

## Authority Hashes

| artifact | SHA-256 |
| --- | --- |
| declaration | `b1663031c9d930642262855f7442428023147f41b9fbda0d2ddb4249dddc5254` |
| request | `5db2ef8929d8788d8e84f0f7ee5ced4c8d063273356d795525efc8ad9eb24e82` |
| result | `bb0ecfe442b869304eadb32ce5b8f66b717665e75fa1a81b5ce3e9294b57c5bb` |
| VISION-024 component result | `a7766c29845087d2106dd9cad25e6789845ddcd7a17f1ac0dcfaccfc4acbb97e` |
| VISION-008 structure result | `e0e1e989dd3109790c842557cf4054f5beb3d450963a72217675b91f06ffa027` |

## Test-First Evidence

The first focused run failed with `ModuleNotFoundError: No module named 'visual_scale_lattice'`.
After implementation, the focused suite passed 7 tests. The first asset validation exposed that the
repo validator implements `not` but not `multipleOf`; the new schema was corrected to an explicit
15-value enum, after which 178 assets passed without changing the shared validator.

## Five-Axis Review

1. Functional: the runtime derives 120 px major spacing, 24 px subdivision spacing, and relative
   pointer index 11 from current doubled-pixel geometry.
2. Contract: three additive schemas, exact authority replay, asset boundary validation, and hotspot
   wiring reject source, geometry, physical-value, or positive-state drift.
3. Security: canonical request admission, repository containment, staged-byte reread, input-snapshot
   recheck, a new external output directory, and atomic promotion are retained.
4. Compatibility: VISION-008/024 authorities and existing visual contracts are unchanged; the new
   result is additive and not connected to the default workflow.
5. Truth: index 11 is dimensionless relative geometry. `physicalQuantity=null` and `unit=null`; it is
   not a physical reading, answer, automatic scale understanding, trust, or live evidence.

## Focused Verification

| verification | result |
| --- | --- |
| `npm --prefix tools/visual-scale-lattice test` | exit 0; 8 passed; 1 Windows symlink privilege skip |
| `npm --prefix tools/visual-scale-lattice run validate:fixtures` | exit 0; 1 canonical fixture |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 178 assets; 3 subject packs; 3 snapshots |
| external runtime invocation | exit 0; major spacing 120 px; subdivision spacing 24 px; relative index 11; physical quantity/unit null; review required; eligible false |

The suite covers declaration and source drift, component/minor-region geometry drift, slot coverage,
physical/trust escalation, canonical identity, repository containment, staged tamper, input-snapshot
drift, and byte-exact replay. The fixed probe directory was removed and verified absent.

`platform_na`: `reason=current Windows token lacks directory-symlink privilege (WinError 1314)`;
`alternative_verification=resolved physical output containment plus direct repository-output rejection`;
`evidence_link=this focused test output`; `expires_at=next privileged Windows verification`;
`recovery_condition=current token can create a directory symlink`.

## Fixed Gates

The complete candidate tree passed the required order with the temporary pinned SDK projected only
inside the relevant gate subprocesses:

| order | command | result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; SDK 10.0.301; 0 warnings; 0 errors; 9.74 s build time |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed; 0 failed; 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 178 assets; 3 subject packs; 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 1015.8 s; toolchain complete |

No bootstrap or system SDK modification was performed.

## Acceptance Boundary

- `repo-side done`: implementation and fixed gates are complete on the VISION-025 branch candidate;
  the atomic commit containing this record is the repository evidence boundary and is not on `main`.
- `workflow integrated`: no.
- `gateway verified`: no new evidence.
- `workstation accepted`: no.
- `live accepted`: no.
- readiness: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`,
  `eligible=false`; no `OptimizationCandidate` is generated.

## Rollback

Rollback the VISION-025 atomic commit. Remove only its schemas, compiler/tests, canonical fixtures,
asset/hotspot wiring, strategy updates, and this evidence file. Preserve VISION-007 through
VISION-024 authorities, `.env`, local environments, gateway, delivery/review, readiness, flywheel,
and canonical samples.
