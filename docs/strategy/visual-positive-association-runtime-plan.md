# Visual Positive Association Runtime Plan

## Scope

`VISION-015` adds one independently admitted public synthetic fixture that can exercise the
existing VISION-007 through VISION-014 pipeline with an honest positive OCR-region association.
The slice proves that the canonical runtime can produce a positive association when its own
pixel, OCR, structure, spatial, and truth evidence supports one. It does not reinterpret the
three frozen VISION-014 cases and does not create Track B semantic evidence.

## Authority finding and selected approach

The current frozen authority contains no positive association: math and senior physics have no
OCR observations, while the junior physics observation is disjoint from its only text-region
candidate. Policy-only positive geometry tests are not canonical evidence.

VISION-015 therefore adds a new deterministic fixture instead of changing the existing source
images, crops, or per-case preprocessing/structure/OCR/spatial/association results. The fixture uses a large, isolated,
renderer-declared label inside an explicit integer crop. Before any authority is committed, a
risk-first probe must show all of the following on the prepared local runtime:

1. RapidOCR emits a non-empty observation whose normalized text exactly matches the renderer
   declaration.
2. The structure extractor emits exactly one eligible text-region candidate for that label.
3. The exhaustive spatial runtime records positive-area overlap between those two endpoints.
4. The association policy selects the pair as bidirectionally unique.

If the probe fails, implementation stops without changing canonical assets. The fallback is to
record the negative finding and redesign the fixture or OCR runtime in a separate reviewed slice;
manually authored observations, copied policy inputs, and self-asserted positive results are not
allowed.

## Alternatives rejected

- Re-rendering one of the three frozen fixtures would rewrite the existing raw-byte authority
  and invalidate historical evidence without improving production acceptance.
- Promoting the positive association unit test or a hand-written `FigureUnderstandingResult`
  would turn test input into false canonical or semantic authority.
- Entering Track B in the same slice would couple diagnostic admission to layout and subject
  semantics before positive association behavior is independently established.

## Authority chain and components

The new case follows the existing component boundaries:

1. The deterministic VISION-007 renderer owns the public synthetic source pixels and explicit
   text declaration. Preprocessing binds source, request, crop bytes, decoded pixels, dimensions,
   bbox, scales, and local engine provenance.
2. VISION-008 extracts pixel-level line, region, and text-region candidates without labels or
   semantics.
3. VISION-009 records the actual local RapidOCR observation without correcting the text or
   treating confidence as correctness.
4. VISION-010 computes the complete candidate-observation Cartesian geometry.
5. VISION-011 independently checks the OCR observation against renderer-declared synthetic
   truth. This diagnostic is a prerequisite for admitting the positive case, but VISION-014
   association selection remains geometry-only.
6. VISION-012 checks text-region coverage against the same renderer declaration without reading
   recognized text.
7. VISION-013 records a transparent `ai_agent` review receipt for the committed crop, with
   `humanReviewed=false` and synthetic diagnostic scope.
8. VISION-014 applies the unchanged bidirectional-uniqueness policy and publishes the positive
   association through the existing request, result, inventory, and report contracts.

Every added authority is canonical-path, physical-identity, raw-byte SHA-256, and upstream-hash
bound. Existing inventories may be extended only through their repository maintenance commands;
runtime callers cannot select alternate inventories or re-sign copied fixtures.

## Data flow and publication

Materialization runs in dependency order and stages every result outside the repository before
atomic promotion. Each downstream compiler snapshots all admitted upstream bytes before work and
rechecks them before promotion. A failure publishes no partial result.

The aggregate association report must continue to preserve the three existing negative cases and
add exactly one positive synthetic case. Metrics remain availability-aware and subject-pack
separated. The positive case cannot change `ReadinessControlReceipt`, release qualification,
delivery trust, review lifecycle, WPF state, or optimization eligibility.

## Fail-closed behavior

The slice rejects or withholds publication for:

- empty or text-mismatched OCR output;
- zero, disjoint, many-to-one, or one-to-many eligible geometry;
- incomplete Cartesian measurements or mismatched endpoint references;
- source, crop, request, result, inventory, report, renderer, model, package, or policy drift;
- path escape, canonical alias, hardlink/symlink/junction identity mismatch, or output overlap;
- changed upstream bytes during compilation or staged-output tampering;
- any positive layout, semantic, Track, live-provider, cloud-egress, readiness, trust, approval,
  or optimization state.

## Verification

Focused verification must include:

- a risk-first local probe before canonical asset edits;
- deterministic replay of the new preprocessing, structure, OCR, spatial, truth, region,
  machine-review, and association artifacts;
- exact positive endpoint and text-truth checks;
- existing unavailable and unmatched cases unchanged;
- positive, disjoint, unavailable, many-to-one, and one-to-many association behavior;
- hash, path, alias, authority, computed-field, TOCTOU, and staged-promotion mutations;
- schema and semantic revalidation through `validate:assets` and canonical replay in the hotspot.

Final verification follows the repository fixed order:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `npm --prefix tools/rule-compiler run validate:cross-subject`
5. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Acceptance boundary

VISION-015 is complete only when the full current-authority chain deterministically reproduces
the new positive association and the fixed-order gates pass. Completion proves positive
association plumbing on one public synthetic diagnostic fixture. It does not prove real OCR or
region quality, production association precision or recall, layout relations, subject semantics,
`FigureUnderstandingResult`, Track B, delivery trust, WPF workflow integration, live gateway
verification, real-data acceptance, or workstation/live acceptance.

`ReadinessControlReceipt` remains `unattested_local_record`; toolchain and restricted-egress
controls remain `not_verified`; `eligible=false`; no `OptimizationCandidate` is generated.

## Follow-on boundary

`VISION-016` may design the first minimal Track B semantic projection only after VISION-015 is
verified and committed. It must define a separate admitted semantic authority and cannot infer
figure meaning from OCR-region association alone.

## Rollback

Rollback VISION-015 additions in reverse dependency order while preserving the original source,
crop, preprocessing, structure, OCR, spatial, and association case request/result bytes. Remove only the new case's association, review, diagnostic,
spatial, OCR, structure, preprocessing, source, inventory/report increments, validator/hotspot
wiring, strategy, and evidence. Do not modify `.env`, OCR environments, gateway configuration,
delivery/review authority, readiness receipts, sample-flywheel authority, or existing canonical
samples.
