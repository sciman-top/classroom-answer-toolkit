# Visual Semantic Projection Runtime Plan

## Scope

`VISION-016` establishes the first deterministic semantic-role projection on top of the
VISION-011 through VISION-015 canonical synthetic authorities. It admits one independent public
synthetic declaration stating that `truth-label-001` in `junior-readable-measurement` has the
role `measurement_reading`, then projects that role only when the current OCR truth match,
text-region coverage match, and OCR-region association form one exact evidence triangle.

This slice is a Track B prerequisite diagnostic. It does not create a question, solve a problem,
parse a unit, infer a numeric quantity, or emit `FigureUnderstandingResult`,
`ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, delivery trust, or WPF state.

## Selected approach

Add a separate semantic declaration and a provider-neutral projection compiler. The declaration
is independent of OCR confidence, extractor output, association policy, and fixture naming. It
declares only the semantic role of a generator truth label; it does not declare an answer or
restate the recognized text.

The compiler may copy the actual OCR observation text into its diagnostic result only after it
proves the complete evidence triangle:

1. the VISION-011 case report maps the declared truth label to exactly one OCR observation with
   `exact_text_positive_overlap`;
2. the VISION-012 case report maps the same truth label to exactly one text-region candidate with
   `positive_overlap`;
3. the VISION-014 case result maps that exact OCR observation and text-region candidate to one
   bidirectionally unique association.

The semantic role comes only from the declaration. The recognized text comes only from the
bound OCR observation. Geometry, OCR confidence, truth text, file names, subject-pack rules, and
association distance cannot synthesize or override the role.

## Alternatives rejected

- Extending `FigureUnderstandingResult` directly would overstate one label-role projection as
  complete figure understanding. The existing broad schema also lacks the raw-byte authority and
  negative dispositions required by this diagnostic chain.
- Emitting an `ocr_layout_solver` `TrackResult` would require a real question reference, evidence
  bundle, answer candidate, and solver authority. The admitted fixture has none of these; creating
  placeholders would turn diagnostic evidence into false Track B completion.
- Adding the semantic role to the VISION-007 renderer definition would couple independent semantic
  authority to pixel generation and force unrelated renderer-bound truth re-signing. A sidecar
  declaration keeps the ownership and rollback boundary explicit.

## Contracts

### VisualSyntheticSemanticDeclaration

The declaration is a committed public synthetic authority with these required concepts:

- `declarationId`, `caseId`, `subjectPack`, and `fixtureKind=synthetic_fixture`;
- `dataClassification.level=public` with no teacher, student, or exam data;
- a raw-byte-bound VISION-011 truth artifact and `truthLabelRef`;
- the bound canonical scale-2 crop raw-byte hash, decoded RGB pixel hash, and dimensions;
- `semanticRole=measurement_reading`;
- `authorityKind=explicit_synthetic_semantic_declaration`;
- local, non-live, no-cloud provenance and a stable generation timestamp.

The first schema deliberately admits only the roles required by committed declarations. It does
not include unit, numeric value, answer, confidence, correctness, layout relation, component type,
or trust fields.

### VisualSemanticProjectionRequest

The request binds one admitted declaration plus the current VISION-011 OCR diagnostic report,
VISION-012 text-region diagnostic report, VISION-014 association result, and the canonical scale-2
crop. Every reference includes repository-relative artifact path and raw-byte SHA-256; request ID,
case ID, subject-pack, crop hashes, and dimensions must agree across the chain.

### VisualSemanticProjectionResult

A successful result contains exactly one projection:

- `projectionId`;
- `semanticDeclarationRef` and `truthLabelRef`;
- `semanticRole=measurement_reading`;
- the exact `ocrObservationRef`, `textRegionCandidateRef`, and `associationRef` proven by the
  evidence triangle;
- `recognizedText` copied from the bound OCR observation;
- `projectionBasis=declared_role_exact_truth_region_association`.

The result also binds its request and upstream authority hashes, records stable local engine
provenance, and fixes these dispositions:

- `diagnosticScope=public_synthetic_semantic_projection`;
- `semanticStatus=projected`;
- `acceptanceDisposition=not_accepted`;
- `requiresHumanReview=true`;
- `layoutDisposition=not_inferred`;
- `figureUnderstandingDisposition=not_generated`;
- `trackDisposition=not_integrated`;
- `deliveryTrustDisposition=not_projected`;
- `wpfDisposition=not_integrated`;
- `liveAcceptanceDisposition=not_accepted`;
- `controlsDisposition=not_verified`;
- `eligible=false` and `optimizationCandidateRefs=[]`.

### Case inventory and report

The first inventory admits exactly the declared semantic case and binds declaration, request, and
expected result bytes. The report replays all admitted cases, records `projected`, `withheld`, or
`unavailable` per case, and publishes counts only. It does not calculate production precision,
recall, semantic accuracy, or acceptance rates. A zero admitted declaration set is invalid.

## Authority loading and data flow

The canonical runtime owns one fixed repository authority root. Callers provide a canonical
request path, not an alternate fixture root or caller inventory.

Compilation proceeds as follows:

1. load and validate the canonical inventory and requested entry;
2. snapshot declaration, request, truth, reports, association, OCR result, crop, and all inventory
   bytes before deriving output;
3. validate schema, canonical containment, physical identity, raw-byte hashes, case/subject/crop
   agreement, and current upstream semantic invariants;
4. resolve the declared truth label in exactly one OCR diagnostic match and one text-region
   diagnostic match;
5. require exactly one VISION-014 association connecting those two resolved endpoints;
6. load `recognizedText` from the exact bound OCR observation and build the projection result;
7. serialize stable JSON to a sibling temporary file outside repository authority;
8. recheck every snapshotted byte and the staged output before atomic promotion.

Canonical fixture maintenance materializes declaration, request, result, inventory, and report in
dependency order. Runtime output cannot overwrite repository authority.

## Fail-closed behavior

Projection is rejected for any of the following:

- missing, duplicate, unknown, or mismatched declaration/truth label;
- OCR diagnostic disposition other than exact-text positive overlap;
- text-region diagnostic disposition other than unique positive overlap;
- association status other than one exact matched edge for the resolved endpoints;
- observation text missing from the bound OCR result or endpoint references not found;
- case, subject-pack, crop, dimensions, decoded pixel hash, or raw-byte hash disagreement;
- path escape, copied authority root, symlink/junction/hardlink alias, output overlap, or unlisted
  nested authority;
- request, inventory, upstream, or staged-output drift during compilation;
- any positive layout, figure-understanding, Track, answer, acceptance, trust, readiness, WPF,
  live-provider, cloud-egress, or optimization state.

The compiler does not fall back to confidence, nearest geometry, fixture names, declaration text,
or subject-pack heuristics.

## Testing and verification

Focused tests cover:

- canonical positive projection and byte-exact replay;
- declaration independence from OCR/extractor/association fields;
- truth-to-observation, truth-to-candidate, and candidate-to-observation endpoint mismatches;
- unmatched, unavailable, ambiguous, duplicate, and missing upstream evidence;
- recognized-text loading from the bound OCR result rather than the declaration;
- schema, path, physical alias, raw-byte hash, crop, computed-field, disposition, TOCTOU, and staged
  output mutations;
- external atomic output and repository-output rejection;
- report coverage, counts, deterministic ordering, and zero-denominator behavior without quality
  metric claims.

Repository verification follows the fixed order:

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `npm --prefix tools/rule-compiler run validate:cross-subject`
5. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## Acceptance boundary

VISION-016 is repo-side complete only when the declaration and projection authorities reproduce
byte-exactly, mutation tests fail closed, the current positive case projects one
`measurement_reading`, and all fixed-order gates pass.

Completion proves that one public synthetic label can receive an explicitly declared semantic role
through a canonical, auditable evidence triangle. It does not prove arbitrary role classification,
numeric measurement understanding, unit parsing, layout semantics, full figure understanding,
question binding, answer generation, Track B solver correctness, real-data quality, delivery trust,
WPF workflow integration, live gateway verification, or workstation/live acceptance.

`ReadinessControlReceipt` remains `unattested_local_record`; controls remain `not_verified`;
`eligible=false`; no `OptimizationCandidate` is generated; cloud egress remains disabled; `.env`
is unchanged.

## Follow-on boundary

A later slice may define a synthetic question/evidence bundle and consume the projected semantic
role as one input to an `ocr_layout_solver` TrackResult. That slice must separately establish
question binding, quantity/unit interpretation, solver authority, answer-candidate provenance, and
fail-closed review semantics. VISION-016 output alone cannot satisfy those requirements.

## Rollback

Remove the VISION-016 schemas, compiler, focused tests, declaration/request/result/inventory/report
assets, validator/hotspot wiring, strategy increments, and evidence. Preserve every VISION-007
through VISION-015 authority byte, OCR environment, `.env`, gateway configuration, visual-evidence
fixtures, delivery/review authority, readiness receipt, WPF state, and canonical sample authority.
