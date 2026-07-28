# Visual Machine Review Runtime Plan

## Scope

`VISION-013` establishes a hash-bound review authority for current AI visual inspection of the three public VISION-007 synthetic scale=2 crops. The review is operationally equivalent to a human visual check only inside the explicitly bounded `synthetic_fixture_diagnostic` acceptance scope. It records the reviewer as `ai_agent`, keeps `humanReviewed=false`, and never maps the review to the existing `humanApproved` input.

The slice exists because deterministic diagnostics can prove bytes, geometry, and replay but cannot record whether a rendered fixture is visibly coherent to an observer. It does not convert that observer judgment into production truth, real-data acceptance, delivery trust, or live authority.

## Authority chain

The canonical authority is a complete inventory under `eval/visual-machine-review/cases/`. Each entry binds one VISION-007 preprocessing result, its canonical scale=2 crop, and one current machine review receipt by canonical repository ref and raw-byte SHA-256. The receipt additionally binds the decoded RGB pixel SHA-256 and pixel dimensions already admitted by preprocessing.

Each receipt must declare:

- `reviewerKind=ai_agent`, `humanReviewed=false`, and `attestationClass=unattested_local_machine_review`;
- `equivalencePolicy=synthetic_fixture_equivalent` and `acceptanceScope=synthetic_fixture_diagnostic`;
- one of `accept_for_diagnostic_use` or `reject_for_diagnostic_use`;
- complete checks for primary-content visibility, required-label legibility, geometry integrity, and crop-boundary disclosure;
- explicit known limitations rather than silently converting clipped content into a clean pass;
- local inspection surfaces, `liveProvider=false`, and `cloudEgress=false`.

The deterministic report compiler validates all upstream and receipt bytes, recomputes per-subject and aggregate counts, and revalidates captured snapshots before external output promotion. It does not re-infer the visual judgment.

## Acceptance

- exactly three current receipts cover `math-answer`, `junior-physics-answer`, and `senior-physics-answer` once each;
- every receipt is bound to current preprocessing/crop authority and passes strict schema plus semantic validation;
- the report independently counts accepted, rejected, limited, machine-reviewed, and human-reviewed cases by subject pack;
- `humanReviewedCount` remains zero, and a mutation that sets `humanReviewed=true`, hides a known clipping limitation, changes the crop, aliases authority, or projects delivery/live trust fails closed;
- focused tests cover deterministic replay, raw-byte drift, path/alias/structure, computed-field drift, staged promotion, and current review policy invariants;
- AI inspection evidence includes direct image rendering plus one Windows image-viewer observation through Computer Use.

## Explicit non-goals

VISION-013 does not create human identity, human signature, `humanApproved`, OCR/layout correctness, `FigureUnderstandingResult`, `ProblemEvidenceBundle`, `TrackResult`, `DecisionRecord`, delivery trust, WPF workflow state, readiness authority, live gateway proof, real-data acceptance, or `OptimizationCandidate`. Controls remain `not_verified`, `ReadinessControlReceipt` remains `unattested_local_record`, and `eligible=false`.

## Rollback

Rollback only the VISION-013 schemas, tool, inventory/receipt/report fixtures, validator/hotspot wiring, strategy increments, and evidence. Preserve VISION-007 through VISION-012 authorities, `.env`, OCR environments, gateway config, delivery/review authorities, readiness receipt, sample flywheel, generated candidates, and teacher feedback authorities.
