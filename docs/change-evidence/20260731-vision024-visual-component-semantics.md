# VISION-024 Visual Component Semantics Evidence

Date: 2026-07-31

## Scope

VISION-024 adds a deterministic public synthetic compiler that projects an independent explicit
component-semantics declaration onto the current `junior-instrument-scale` structure, preprocessing,
and 2x crop authorities. It emits one pointer edge group and five major-tick edge groups and performs
no automatic component, scale, reading, question, answer, provider, or cloud inference.

## Authority Hashes

| artifact | SHA-256 |
| --- | --- |
| declaration | `bea25d2f28b7c9ac75edf357c41181a75b72dbccfad62b6e63f6a929ebd5d76d` |
| request | `f4c756efb999bd3e14f1d14b4d783f20c480d5946d4a9aca279db9a7632c70e2` |
| result | `a7766c29845087d2106dd9cad25e6789845ddcd7a17f1ac0dcfaccfc4acbb97e` |
| VISION-008 structure result | `e0e1e989dd3109790c842557cf4054f5beb3d450963a72217675b91f06ffa027` |
| VISION-007 preprocessing result | `da5c7d84dabde7dc55df2a04a6441274b1f8616fdf8f653b68f6b00f2c2cb01b` |
| 2x crop raw bytes | `70577ca429dbc6afd5b2ecf536fe4712001bfddd961f9a041b103dca5fb8bb40` |
| 2x crop decoded RGB pixels | `4efe1386d15ea467781942982c77f2c6a38968509c79e72878eacf53fc711e30` |

## Test-First Evidence

The first focused run failed because the new module did not yet exist. After implementation, the
focused suite passed 8 tests and skipped only the Windows symlink case under the current token. The
external runtime probe emitted six components and preserved every negative disposition, then its
fixed temporary directory was removed and verified absent.

## Five-Axis Review

1. Functional: the explicit declaration compiles exactly one pointer and five ordered major ticks.
2. Contract: three additive schemas, runtime invariants, asset validation, and hotspot wiring reject
   unsupported or positive-state drift.
3. Security: canonical request admission, repository containment, actual upstream revalidation,
   staged-byte reread, input-snapshot recheck, a new external output directory, and atomic promotion
   are retained.
4. Compatibility: VISION-007/008/023 authorities and existing generic visual contracts are unchanged;
   this slice adds no default workflow behavior.
5. Truth: `explicit_declared` is not automatic detection or understanding. Scale range, division,
   numeric reading, FigureUnderstanding, question binding, Track input, answer authority, trust, and
   live claims remain absent or explicitly negative.

## Focused Verification

| verification | result |
| --- | --- |
| `npm --prefix tools/visual-component-semantics test` | exit 0; 8 passed; 1 Windows symlink privilege skip |
| `npm --prefix tools/visual-component-semantics run validate:fixtures` | exit 0; 1 canonical fixture |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 175 assets; 3 subject packs; 3 snapshots |
| external runtime invocation | exit 0; 6 components; 1 pointer; 5 major ticks; inference not performed; review required; eligible false |

The suite covers crossed/duplicate refs, unsupported type, source/hash drift, trust escalation,
canonical identity, output containment, staged tamper, input-snapshot drift, and byte-exact replay.

`platform_na`: `reason=current Windows token lacks directory-symlink privilege (WinError 1314)`;
`alternative_verification=resolved physical output containment plus direct repository-output rejection`;
`evidence_link=this focused test output`; `expires_at=next privileged Windows verification`;
`recovery_condition=current token can create a directory symlink`.

## Fixed Gates

The complete candidate tree passed the required order with the temporary pinned SDK projected only
inside the relevant gate subprocesses:

| order | command | result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; SDK 10.0.301; 0 warnings; 0 errors; 11.30 s build time |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed; 0 failed; 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 175 assets; 3 subject packs; 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 931.3 s; toolchain complete |

No bootstrap or system SDK modification was performed.

## Acceptance Boundary

- `repo-side done`: implementation and fixed gates are complete on the VISION-024 branch candidate;
  the atomic commit containing this record is the repository evidence boundary and is not on `main`.
- `workflow integrated`: no.
- `gateway verified`: no new evidence.
- `workstation accepted`: no.
- `live accepted`: no.
- readiness: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`,
  `eligible=false`; no `OptimizationCandidate` is generated.

## Rollback

Rollback the VISION-024 atomic commit. Remove only its schemas, compiler/tests, canonical fixtures,
asset/hotspot wiring, strategy updates, and this evidence file. Preserve VISION-007 through
VISION-023 authorities, `.env`, local environments, gateway, delivery/review, readiness, flywheel,
and canonical samples.
