# 2026-08-13 risk-aware model routing and comparison guard

## Scope

- Extended the existing four-tier AI Gateway route with explicit, evidence-backed risk signals.
- Bound evaluated real-paper stages to the model and reasoning effort recorded by their existing live evidence.
- Added a fail-closed comparator that refuses to recommend a tier without repeated same-paper, same-stage comparisons.
- Preserved the existing gateway, egress, reference-review, trust, and teacher-acceptance boundaries.

## Routing behavior

- `multi_part` upgrades a low-complexity task to the normal tier.
- `visual_binding`, `unit_conflict`, `validator_conflict`, `prior_regression_failure`, and `reference_conflict` upgrade semantic generation/review to `gpt-5.6-sol/xhigh` and visual findings work to `gpt-5.6-terra/xhigh`.
- Signals are explicit caller facts and are recorded in the routing receipt. They are not inferred from model self-confidence.
- Provider order remains availability failover. The first protocol-successful answer returns; fallback is not represented as independent semantic review.

## Model-tier evidence boundary

- The 2024 and 2025 checked-in baselines are bound to their recorded `gpt-5.6-sol/medium` executions.
- A comparable group requires the same `comparisonKey` and stage to have real results from at least two tiers.
- A recommendation requires at least two comparable groups, two eligible tiers, and a unique accuracy winner.
- Current output is `insufficient_comparative_evidence` for blind generation, visual audit, and reference review because no same-paper multi-tier run is checked in.
- No live provider request was made in this slice. Cloud egress remained disabled.

## Verification

| Command | Result |
| --- | --- |
| `npm --prefix tools/ai-gateway run test:answer` | exit 0; 23/23 passed |
| `npm --prefix eval/real-paper test` | exit 0; 5/5 passed |
| `npm --prefix eval/real-paper run validate` | exit 0; all three stages report `insufficient_comparative_evidence`; recommendation is null |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0; 34/34 passed |
| `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0; Core complete in 60.54 s; 14 answer eval cases passed |

## Truth boundary and rollback

- Proven: repository routing logic, receipts, configuration contract, offline real-paper comparison guard, and Core toolchain behavior.
- Not proven: live endpoint availability, one tier being optimal, improved live answer accuracy, visual review acceptance, trusted delivery, or teacher acceptance.
- `VISION-101` remains blocked by its existing authority, provider-stability, and budget conditions.
- Rollback: revert this evidence file, the ROUTE-101 ledger row, the risk-signal routing changes, and the real-paper execution/comparator fields as one slice. Do not modify `.env` or existing authority/delivery artifacts.
