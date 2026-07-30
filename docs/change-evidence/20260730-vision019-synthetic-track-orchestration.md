# VISION-019 Synthetic Track Orchestration Evidence

## Goal and authority boundary

- Goal: admit current question, ProblemEvidenceBundle, and independent Track A/B/C raw bytes;
  compare Track A/B; record conflict and degradation; preserve Track C and all-source blockers; and
  compile the final DecisionRecord through the existing canonical compiler.
- Canonical inputs: VISION-017 question/ProblemEvidenceBundle/Track B, VISION-018 Track C, and one
  independent public synthetic Track A for the same `12 cm` candidate.
- Canonical result: A/B agreement, complete A/B/C inventory, Track C pass, one Track B blocking
  source finding, and one fail-closed DecisionRecord.
- State preserved: `review_required`, `humanApproved=false`, `trusted=false`,
  `visualReviewPassed=null`, controls=`not_verified`, `eligible=false`, and no
  `OptimizationCandidate`.
- `ReadinessControlReceipt` remains `unattested_local_record`; cloud egress remains disabled.
- This is real repo-side orchestration runtime execution over public synthetic sources. It is not a
  real VLM Track A, production OCR/layout Track B, real-data Track C, approved answer, WPF default
  workflow, gateway verification, workstation acceptance, or live acceptance.

## Canonical authority

| Artifact | SHA-256 |
| --- | --- |
| independent synthetic Track A | `02478521b988d210796ebc9da6caade2f82a4032021d859e17fac1ba1987ea14` |
| orchestration request | `72d9a5af908f68da502f2ead730d7777141efa05f9dd4c282e09c64c6e403a3b` |
| orchestration report | `33e358052ca5b4b2257e2a579edd83b13b13a8f5c928d42c2e47933e89c38921` |
| DecisionRecord | `29f3af7ba06aa66895dce047eb01bd594de7332d0bb8c8aa2f616d9ad7da67cd` |

The request fixes the required inventory to `vlm_direct / ocr_layout_solver / rule_validator`; a
caller cannot remove an expected type to hide degradation. Every source is rebound by normalized
repository-relative ref, current raw-byte hash, type/id, evidence bundle, and exact question
identity/hash before orchestration.

The report keeps independent axes:

- `comparison.status=agreement` with normalized candidate `12 cm`;
- `orchestrationStatus=complete` and `missingTrackTypes=[]`;
- `trackCDisposition.status=pass` for VISION-018's seven limited checks;
- `sourceBlockingFindingRefs` identifies
  `track-b-junior-readable-measurement-synthetic:synthetic_track_b_requires_review`.

The DecisionRecord is compiled by `tools/visual-evidence/decision-record.mjs`, not a second policy.
It remains `review_required`, routes to `high_risk_approval`, and includes
`dual_track_match / high_risk_visual / rule_validator_failed / acceptance_tier_unverified /
review_pending`. The Track B blocker explains `rule_validator_failed` under the existing compiler
semantics even though Track C itself passes.

## Fail-closed and atomic behavior

- Source hash drift, cross-question binding, duplicate track types/ids, and expected-set shrink
  attempts are rejected before decision compilation.
- Missing Track A is reported as degraded and not comparable; missing Track C is degraded while
  preserving the independent A/B agreement result. Both become `evidence_chain_missing` through
  the canonical compiler's additive `requiredTrackTypes` input.
- A/B conflict remains explicit and produces `dual_track_conflict`.
- Track C blocking findings are source-attributed and remain visible to the DecisionRecord.
- Runtime requests must be current repository authorities. Output is limited to a new external
  directory, stages both report and DecisionRecord, and atomically promotes the directory.
- Existing output, lexical repository output, and an external junction resolving into repository
  authority are rejected. Failed staging is removed and cannot expose a partial pair.

## Focused verification

- Track orchestrator: 11 passed, 0 failed, 0 skipped.
- DecisionRecord contracts after the required-track extension: 15 passed, 0 failed, 0 skipped.
- Canonical replay: 4 artifacts validated byte-exactly.
- JavaScript syntax checks passed for the orchestrator, tests, and DecisionRecord compiler.
- Asset validation: 163 assets, 3 subject packs, and 3 snapshots.
- `git diff --check`: passed.

## Five-axis review

Review covered tests first, then correctness, readability/simplicity, architecture, security, and
performance. Required findings and resolutions:

1. The initial request allowed callers to shrink `expectedTrackTypes`, which could hide a missing
   track. The runtime now requires the exact ordered A/B/C inventory and has a regression test.
2. The first report exposed only Track C pass, which could obscure the canonical Track B blocking
   finding and make `rule_validator_failed` look contradictory. Track C disposition and all-source
   blocking refs are now separate, explicit fields.
3. Candidate comparison and missing-track degradation initially shared one status enum, so a
   missing Track C could hide A/B agreement or conflict. The report now keeps independent
   `comparison` and `orchestrationStatus` axes, including a missing-C agreement regression.
4. The new schemas initially used `allOf` and a union `type`, which the repository's focused schema
   validator does not implement. They were rewritten to supported explicit objects and `anyOf`, so
   the repo gate enforces rather than silently ignores the intended constraints.
5. Initial staging showed checkout EOL conversion warnings for the new canonical JSON authority.
   `.gitattributes` now fixes `eval/track-orchestration/**/*.json` to LF, preserving the recorded
   raw-byte hashes across Windows worktrees.

No Critical or Required finding remains. The runtime uses bounded local JSON reads and at most
three source tracks, performs no network access, provider call, or unbounded work, and adds no
dependency. The 685-line implementation remains below the review skill's 1000-line inspection
signal and follows the existing single-file deterministic runtime pattern.

## Repository gate evidence

Final fixed-order verification ran from the Codex worktree on the reviewed implementation and
strategy tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors; 12.2 s |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 163 assets, 3 subject packs, 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; all hotspot gates passed; 1018.9 s |

Gate subprocesses used `%TEMP%\classroom-toolkit-dotnet-10.0.301` through temporary
`DOTNET_ROOT/PATH`. Bootstrap was not run and the system SDK was not modified. The hotspot used the
existing ignored OCR venv and renderer dependency junctions; they are not tracked changes.

Gateway template validation allowed missing example secrets, reported cloud egress disabled, and
made no live provider request. It is config/contract evidence only, not gateway verification.

## N/A and acceptance boundary

- `platform_na`: Windows probes that require symlink privilege may remain skipped under the current
  token. Alternative coverage includes canonical/physical containment, hardlink checks in existing
  tools, and the new external-junction output regression. Recovery condition: rerun privileged
  symlink probes before any trust expansion.
- `gate_na`: `answer-graphics` remains experimental and outside the default product gate. Recovery
  condition: add an approved smoke only after a future decision promotes it into the default
  delivery contract.
- `repo-side done`: pending this atomic commit, source admission, comparison, degradation,
  blocker projection, canonical DecisionRecord reuse, schemas, fixtures, hotspot, strategy, and
  evidence are implemented and verified.
- `workflow integrated`: no. The WPF default answer workflow does not call this runtime.
- `gateway verified`: no live provider/gateway request occurred.
- `workstation accepted`: no.
- `live accepted`: no.
- `still open`: production image automation and native docx input; real provider Track A/B/C and
  evidence compilation on legal real data; source-question-to-`answer.md`; WPF review approval,
  lifecycle writeback and persistent queue ownership; real benchmarks and teacher acceptance;
  optimization admission/rollout; and renderer parity/migration.

## Rollback

Revert the VISION-019 commit and remove only its EOL rule, request/report schemas, track orchestrator,
Track A/request/report/DecisionRecord fixtures, DecisionRecord required-track hook, hotspot wiring,
strategy increments, and this evidence. Preserve VISION-007 through VISION-018 authorities and
commits `c291f9d`/`9c0d4f5`, `.env`, ignored OCR/renderer environments, gateway/review/readiness/WPF/
flywheel authorities, and all sample authorities.
