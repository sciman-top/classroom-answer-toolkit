# Visual Page Normalization Runtime Plan

## Scope

`VISION-020` adds the first deterministic captured-page normalization runtime. It derives one
public synthetic capture from the committed VISION-007 measurement source, detects the largest
external convex quadrilateral, and emits a rectified, denoised `NormalizedPage` plus PNG.

This slice establishes the coordinate authority required before automatic region proposal. It does
not establish production photo quality, question/figure region detection, OCR correctness, semantic
understanding, provider execution, WPF integration, or live acceptance.

## Dependency order

Production image input proceeds in this order:

1. Normalize page orientation, perspective, trim, and noise into one stable page coordinate space.
2. Propose question, figure, formula, table, and other regions against that normalized authority.
3. Compile axis, table, tick, legend, and subject-component semantics from admitted regions.

VISION-007 remains the explicit-bbox crop authority. VISION-020 is a separate captured-page
authority and does not silently reinterpret VISION-007 fixtures as automatic region detections.

## Selected design

- The canonical capture is 720 x 540, public synthetic, locally generated from the hash-bound
  VISION-007 source with a fixed perspective transform and deterministic Gaussian noise.
- Detection uses thresholding, morphological closing, the largest external convex quadrilateral,
  and a minimum page area ratio of 0.25.
- The detected quadrilateral is ordered, perspective-warped to 560 x 360 with linear interpolation,
  and passed through a fixed 3 x 3 median denoise.
- The result binds request, capture, normalized PNG raw bytes, decoded RGB pixels, dimensions,
  detected geometry, correction flags, and OpenCV/Pillow provenance.
- Runtime input is restricted to the current canonical request. Output must be a new external
  directory whose lexical and physical parent remain outside repository authority.
- The PNG/result pair is written to one staging directory, byte-reverified, and atomically promoted.
  Canonical request/capture snapshots are rechecked immediately before promotion.
- Focused tests validate fixtures but never rematerialize repository authority; explicit
  `materialize:fixtures` is the only generation entrypoint.

## Canonical semantics

- Detected page quadrilateral: `(74,89) / (646,61) / (670,470) / (56,484)`.
- Detected area ratio: `0.607368`; top-edge orientation: `-2.802452` degrees.
- Normalized page: 560 x 360, `sourceKind=image`, correction flags true, and
  `qualityFlags=[rotated]`.
- `regionRefs=[]`: no automatic region proposal has been implemented.
- Scope is `public_synthetic_page_normalization`; human review remains required,
  `acceptanceDisposition=not_accepted`, controls=`not_verified`, and `eligible=false`.
- `liveProvider=false`, `cloudEgress=false`, and no `OptimizationCandidate` is generated.

## Verification

Focused coverage includes positive normalization, no-page rejection, policy and capture-byte
drift, noncanonical request rejection, existing/repository output rejection, external junction
containment when the Windows token permits symlinks, atomic external pair output, staging tamper
rejection, byte-exact canonical replay, schema validation, and visual inspection of capture and
normalized PNGs.

The fixed repository gate remains:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Acceptance boundary

`repo-side done` for this slice means one synthetic captured page can be deterministically detected,
normalized, schema-validated, replayed, visually inspected, and emitted through a fail-closed local
runtime. It does not mean production image automation is complete, the page is OCR-correct, any
region or question is bound, Track A/B/C consumes the output, the answer workflow is integrated, or
gateway/workstation/live acceptance has occurred.

## Follow-on boundary

The next slice may add deterministic automatic region proposal against this normalized coordinate
authority while preserving VISION-007 explicit-bbox semantics. Multi-scale/local high-resolution
crops and axis/table/tick/legend/component semantic artifacts follow only after region authority is
stable. Native `docx -> NormalizedPage` remains an independent adapter slice. Real-photo benchmarks
require legal real data and separate evidence.

## Rollback

Revert only the VISION-020 commit and remove its request/result schemas, page-normalizer tool,
canonical capture/request/normalized/result artifacts, EOL rules, asset/hotspot wiring, strategy
increments, and evidence. Preserve VISION-007 through VISION-019 authorities and commits
`c291f9d`/`9c0d4f5`/`c09886b`, local ignored OCR/renderer environments, `.env`, gateway/review/
readiness/WPF/flywheel authorities, and all prior sample authorities.
