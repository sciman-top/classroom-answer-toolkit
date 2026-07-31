# VISION-023 Visual Region Semantics Evidence

Date: 2026-07-31

## Scope

VISION-023 adds a deterministic public synthetic compiler that projects an independent explicit
region-semantics declaration onto the current VISION-021 proposal and VISION-022 crop authorities.
It emits two bounded VisualRegion-shaped artifacts and performs no pixel, filename, OCR, question,
answer, provider, or cloud inference.

Canonical declarations:

| proposal | region type | semantic role | component kind |
| --- | --- | --- | --- |
| `content-block-001` | `text_area` | `measurement_reading` | `recognized_value_component` |
| `content-block-002` | `scale_area` | `measurement_scale_baseline` | `scale_baseline_component` |

## Authority Hashes

| artifact | SHA-256 |
| --- | --- |
| declaration | `7f12eee134acde820830343d0e630dcdc0d6fb29f58c35bf5ba5fefd62e85fe7` |
| request | `8e47a46712ab26d84d0825572b56ca9f9c7f13e16d7e897f27f786e1f5618288` |
| result | `fb11cdbd10e473a79883fda7102427164d5f3a0a9b18466ee315dfcadf754c09` |
| VISION-021 proposal result | `9597538175dd97686b1358de2515159c468cdafc62bf0ce71c49a8385bb319d4` |
| VISION-022 local-crop result | `162d96d1ca4e15282e16d159853459c4843475f972d9045b99d80706acac506d` |

The result also rebinds the four existing crop raw-byte hashes, decoded RGB pixel hashes,
dimensions, interpolation modes, proposal refs, and exact bboxes.

## Test-First Evidence

The first focused run failed with `ModuleNotFoundError: No module named 'visual_region_semantics'`.
After implementation:

| verification | result |
| --- | --- |
| `npm --prefix tools/visual-region-semantics test` | exit 0; 11 tests, 1 Windows symlink privilege skip |
| `npm --prefix tools/visual-region-semantics run validate:fixtures` | exit 0; 1 canonical fixture |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 172 assets, 3 subject packs, 3 snapshots |
| external runtime invocation | exit 0; 2 regions; inference not performed; review required; eligible false |

The focused suite covers crossed proposal refs, unsupported role/type, stale crop hash/bbox,
request/upstream drift, trust escalation, canonical identity, output containment, staged tamper, and
byte-exact replay. Windows junction creation is unavailable under the current unprivileged token and
is skipped without weakening the runtime containment check.

## Five-Axis Review

1. Functional: exactly two declarations compile to two proposal/crop-bound regions with fixed order.
2. Contract: three additive schemas, runtime semantic invariants, asset validation, and hotspot wiring
   reject unsupported or positive-state drift.
3. Security: canonical request admission, repository containment, actual PNG revalidation, staged
   byte re-read, input snapshot recheck, new external output directory, and atomic promotion are kept.
4. Compatibility: VISION-020/021/022 bytes and existing generic VisualRegion schema are unchanged;
   the new result embeds a compatible VisualRegion shape and adds no default workflow behavior.
5. Truth: `explicit_declared` is not inference or classification quality. Question binding, generic
   axis/table/tick/legend understanding, Track input, answer authority, trust, and live claims remain
   absent or explicitly negative.

## Fixed Gates

The complete candidate tree passed the required order with the temporary pinned SDK projected only
inside the relevant gate subprocesses:

| order | command | result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; SDK 10.0.301; 0 warnings; 0 errors; 10.89 s build time |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed; 0 failed; 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 172 assets; 3 subject packs; 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 974.1 s; toolchain complete |

No bootstrap or system SDK modification was performed.

## Acceptance Boundary

- `repo-side done`: implementation and fixed gates complete on the VISION-023 branch candidate; the
  atomic commit containing this record is the repository evidence boundary and is not yet on `main`.
- `workflow integrated`: no.
- `gateway verified`: no new evidence.
- `workstation accepted`: no.
- `live accepted`: no.
- readiness: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`,
  `eligible=false`; no `OptimizationCandidate` was generated.

## Rollback

Rollback the VISION-023 atomic commit. Remove only its schemas, compiler/tests, canonical fixtures,
asset/hotspot wiring, strategy updates, and this evidence file. Preserve VISION-007 through
VISION-022 authorities, `.env`, local environments, gateway, delivery/review, readiness, flywheel,
and canonical samples.
