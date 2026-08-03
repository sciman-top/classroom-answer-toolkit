# Visual Region Proposal Runtime Plan

## Scope

`VISION-021` adds the first deterministic automatic region-proposal runtime over the hash-bound
VISION-020 normalized page. It detects foreground connected content blocks and emits nonsemantic
`RegionProposalCandidate` bounding boxes plus a diagnostic overlay.

This slice proves automatic proposal plumbing in one stable normalized coordinate space. It does
not classify a proposal as question, figure, text, formula, table, axis, scale, tick, legend, or
subject component, and it does not generate `VisualRegion` authority.

## Selected design

1. Reload and rehash the VISION-020 normalization result and normalized PNG current bytes.
2. Require the upstream `NormalizedPage` identity, 560 x 360 pixel authority, empty `regionRefs`,
   local-only provenance, controls=`not_verified`, and `eligible=false`.
3. Ignore an 8-pixel page inset, threshold foreground at grayscale value 180, close with a fixed
   3 x 3 kernel, and use 8-connected components with minimum foreground area 20.
4. Sort admitted components top-to-bottom then left-to-right, pad each bbox by 8 pixels, cap the
   inventory at 16, and record raw component bounds, padded bounds, area, coverage, and page-boundary
   contact.
5. Keep every proposal `proposalKind=content_block_candidate` and `heuristicOnly=true`; do not reuse
   the semantic `VisualRegion.regionType` enum.
6. Draw one uniform-color diagnostic overlay. Its bytes are bound but its disposition remains
   `diagnostic_only` and it is not an evidence or semantic authority.
7. Runtime input is restricted to the current canonical request. The overlay/result pair is staged,
   byte-reverified, checked against upstream input snapshots, and atomically promoted to a new
   directory outside repository authority.

## Canonical semantics

The public synthetic normalized measurement page produces exactly two candidates:

| Proposal | Source component bbox | Padded proposal bbox |
| --- | --- | --- |
| `content-block-001` | `(262,155,37,49)` | `(254,147,53,65)` |
| `content-block-002` | `(97,263,370,10)` | `(89,255,386,26)` |

Both are heuristic content blocks and neither touches the page boundary. The first happens to cover
the visible `12` pixels and the second the long line, but those observations do not assign text,
measurement, figure, scale, or axis semantics.

The result fixes `semanticDisposition=not_inferred`, `visualRegionDisposition=not_generated`, human
review required, `acceptanceDisposition=not_accepted`, controls=`not_verified`, `eligible=false`,
`liveProvider=false`, `cloudEgress=false`, and no `OptimizationCandidate`.

## Verification

Focused coverage includes the exact two proposals, precise candidate field inventory and computed
areas/coverage, empty-page rejection, policy and upstream hash drift, noncanonical request rejection,
existing/repository output rejection, external junction containment when the Windows token permits
symlinks, staging tamper rejection, atomic external output, byte-exact canonical replay, schema
validation, and visual inspection of the diagnostic overlay.

The fixed repository gate remains:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Acceptance boundary

`repo-side done` means one public synthetic normalized page can produce deterministic, hash-bound,
nonsemantic content-block proposals and a diagnostic overlay through a fail-closed local runtime.
It does not mean region precision/recall is known, proposal types are classified, `VisualRegion` is
generated, local high-resolution crops exist, OCR/layout/Track consumes the result, WPF is wired, or
gateway/workstation/live acceptance has occurred.

## Follow-on boundary

The next production-image slice may use admitted proposal authority to create multi-scale and local
high-resolution crops while preserving candidate/semantic separation. Axis/table/tick/legend/
component semantic artifacts follow only after a separate classification and validation contract.
Real-image region benchmarks require legal real data and cannot be replaced by this fixture.

## Rollback

Revert only the VISION-021 commit and remove its request/result schemas, region-proposer tool,
canonical request/result/overlay, EOL rules, asset/hotspot wiring, strategy increments, and evidence.
Preserve VISION-007 through VISION-020 authorities and commits `c291f9d`/`9c0d4f5`/`c09886b`/
`26f1238`, ignored local environments, `.env`, gateway/review/readiness/WPF/flywheel authorities,
and prior sample authorities.
