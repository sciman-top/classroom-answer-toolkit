# VISION-018 Synthetic Track C Validator Evidence

## Goal and authority boundary

- Goal: independently validate the current VISION-017 `12 cm` Track B candidate against the
  public synthetic question, ProblemEvidenceBundle, semantic projection, solver request, and
  Track B raw bytes.
- Result: one deterministic ConsistencyReport with seven checks and one `rule_validator`
  TrackResult.
- Canonical checks: question binding, quantity, explicit unit whole-token binding, ASCII-decimal
  numeric format, exact answer format, semantic/solver provenance, and review boundary.
- Scope: repo-side limited synthetic consistency validation only. It is not a scale-reading
  validator, general unit or physics validator, solver-correctness proof, real-question grounding,
  or real-data quality result.
- No Track A/B/C orchestration, comparison/conflict/degradation, DecisionRecord, review approval,
  delivery trust, WPF writeback, gateway live request, workstation acceptance, or live acceptance
  is produced.
- State preserved: high risk, review required, `humanApproved=false`, `trusted=false`,
  `visualReviewPassed=null`, controls=`not_verified`, `eligible=false`, and
  `optimizationCandidateRefs=[]`.
- `ReadinessControlReceipt` remains `unattested_local_record`; cloud egress remains disabled.

## Input and output authority

`SyntheticTrackValidatorRequest` binds five current upstream artifacts and the validator policy by
raw-byte SHA-256. Track C rechecks current bytes, embedded provenance, identities, and canonical
artifact references rather than trusting Track B's self-report.

Canonical output hashes:

| Artifact | SHA-256 |
| --- | --- |
| validator request | `09d889ebecbe5960e68b40b4c860fd6ee5b8a4b1bb16634597ffc82368bf7ca4` |
| ConsistencyReport | `673a660549ae40c10cdee12061813c316adfb394cf3b77016577f301a75c431c` |
| Track C result | `d088fd4daf392fe5b187f505722bec662892a166493eaa217c9c17bc9fb7b598` |

The canonical report has seven `pass` checks and recommends
`acceptance_tier_unverified`. Its `groundingSufficient=true` means only that the five admitted
public synthetic authorities are complete for these seven checks. It is not real-question
grounding, answer approval, or delivery acceptance.

## Fail-closed behavior

- Principal semantic mismatches compile an identified blocking check and matching Track C
  `validatorFinding`.
- Stale input/request hashes and altered canonical artifact refs are rejected before semantic
  checks.
- The runtime accepts only the fixed canonical request and writes exactly the report and Track C
  result to one new external directory.
- Existing output, lexical repository output, and an external junction resolving into repository
  authority are rejected.
- Both files are schema-validated in one staging directory and promoted together; failures clean
  staging and do not expose a partial result directory.

## Test-first verification

- Initial unimplemented red run: 0 passed, 9 failed.
- First implementation run: 7 passed; 2 failed only because canonical artifacts had not yet been
  materialized.
- Canonical materialization and schema validation: 3 artifacts generated and replayed byte-exactly.
- Final focused suite after review fixes: 10 passed, 0 failed, 0 skipped.
- Two consecutive materializations plus canonical validation passed on Windows.
- Asset validation after integration: 163 files, 3 subject packs, and 3 snapshots.
- VISION-016/017 upstream authority diff from parent commit `c291f9d`: none.

## Five-axis review

Review covered tests first, then correctness, readability, architecture, security, and
performance. Required findings and resolutions:

1. The initial design omitted the VISION-017 solver request input, so Track C could not
   independently rehash `sourceRequestSha256`. The solver request became a fifth request-bound
   authority and is checked against Track B provenance and current solver policy.
2. Input hashes and IDs were checked, but request `artifactRef` values were not revalidated.
   A red-green regression now rejects input or output ref drift and cross-checks the refs embedded
   by the question bundle, solver request, and Track B.

No Critical or Required finding remains. The runtime has bounded reads over five fixed JSON
artifacts and writes two bounded outputs. It performs no network access, provider call, unbounded
iteration, or shared hot-path work. No dependency was added.

## Repository gate evidence

Final fixed-order verification ran from the Codex worktree on the reviewed tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 163 assets, 3 subject packs, 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; all hotspot gates passed |

The host system lookup does not provide the exact pinned SDK `10.0.301`. Gate subprocesses use
`%TEMP%\classroom-toolkit-dotnet-10.0.301` through temporary `DOTNET_ROOT` and `PATH` values.
Bootstrap was not run and the system SDK was not modified.

The hotspot uses the existing Git-ignored OCR venv and renderer dependency junctions. They are
local worktree projections, not tracked changes. Gateway template validation allows missing
example secrets, reports cloud egress disabled, and makes no live request.

## N/A and acceptance boundary

- `platform_na`: existing visual symlink probes requiring a token with symlink privilege may
  remain skipped. Alternative coverage includes hardlink/physical identity, canonical containment,
  copied-root, path escape, TOCTOU, staged-tamper, and the new junction tests. Recovery condition:
  rerun on a Windows token with symlink capability before any trust expansion.
- `gate_na`: `answer-graphics` remains experimental and outside the default product gate. Recovery
  condition: execute an approved smoke only after a future decision promotes it into the default
  delivery contract.
- `repo-side done`: pending this evidence commit, request/report/Track C runtime, schemas,
  canonical artifacts, validators, hotspot wiring, and strategy truth are implemented and
  verified.
- `workflow integrated`: no.
- `gateway verified`: no live gateway/provider verification occurred.
- `workstation accepted`: no.
- `live accepted`: no.
- `still open`: real Track A/B/C provider orchestration, comparison/conflict/degradation and
  evidence compiler runtime; production image/docx inputs; provider-to-`answer.md`; WPF review and
  trust lifecycle; legally sourced benchmarks/acceptance; optimization admission; and renderer
  migration/parity.

## Rollback

Revert the VISION-018 commit and remove only its request schema, additive report/TrackResult schema
fields, tool, canonical request/report/Track C artifacts, asset/hotspot wiring, strategy updates,
and this evidence. Preserve parent VISION-017 commit `c291f9d`, all VISION-007 through VISION-017
authorities, `.env`, local OCR/renderer environments, gateway settings, delivery/review
authorities, readiness receipts, WPF state, flywheel authorities, and sample authorities.
