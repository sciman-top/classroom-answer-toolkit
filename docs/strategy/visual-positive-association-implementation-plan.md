# VISION-015 Implementation Plan

## Goal

Add one public synthetic fixture that produces an honest canonical positive OCR-region
association through the existing VISION-007 through VISION-014 authority chain, while preserving
the three frozen cases and every non-semantic, non-production acceptance boundary.

## Dependency graph

The implementation order is fixed by raw-byte authority:

`risk probe -> preprocessing -> structure -> OCR -> spatial -> OCR truth -> region truth -> machine review -> association -> repository gates`

The downstream tools import or validate the current upstream `DEFINITIONS`, inventories, and
hashes. Adding a canonical case to only one stage makes every later stage incomplete by design.
The repository therefore uses two distinct checkpoints:

1. an untracked, repository-external probe that may fail without changing authority;
2. one atomic canonical cutover after all eight stage outputs reproduce in a temporary tree.

This is the smallest slice that leaves every committed revision internally coherent. Individual
stage work is still tested in dependency order before the authority cutover is committed.

## Phase 1: Risk-first probe

### Task 1: Prove fixture feasibility outside canonical authority

**Description:** Render a deterministic public synthetic image with one large isolated ASCII
measurement label, run the prepared local structure and RapidOCR components, and evaluate the
existing spatial and association policy in a temporary directory outside the repository.

**Acceptance criteria:**

- RapidOCR emits exactly one observation with normalized text equal to the renderer declaration.
- The structure extractor emits exactly one eligible text-region candidate for the label.
- The candidate and observation have positive-area overlap and are bidirectionally unique.
- No tracked file, canonical inventory, `.env`, provider setting, or cloud-egress setting changes.

**Verification:** Save command, component versions, image dimensions, normalized text, endpoint
counts, bounds, and intersection area in the eventual VISION-015 evidence. Confirm `git status`
matches the pre-probe state.

**Dependencies:** Approved VISION-015 design.

**Likely touched files:** None; temporary artifacts only.

**Failure route:** Stop. Record the negative probe result and redesign in a separate strategy
slice. Do not hand-author an OCR observation or canonical positive result.

## Phase 2: Temporary full-chain rehearsal

### Task 2: Rehearse the eight-stage authority chain

**Description:** Add the candidate definition in a temporary copied authority tree and exercise
the existing stage compilers in dependency order before editing canonical repository assets.

**Acceptance criteria:**

- Every stage emits schema-valid, semantically valid, deterministic output.
- Existing three source/crop and preprocessing/structure/OCR/spatial/association case request/result bytes remain unchanged when their current materializers replay; renderer-bound truth is expected to re-sign when the renderer source hash changes.
- The new case reaches exact OCR truth, positive region coverage, transparent machine-review
  input, and one positive association without layout or semantic state.

**Verification:** Run each focused package test or equivalent compiler replay against the
temporary tree and compare two independent materializations byte-for-byte.

**Dependencies:** Task 1.

**Likely touched files:** None; temporary copies only.

## Phase 3: Atomic canonical cutover

### Task 3: Extend preprocessing, structure, OCR, and spatial authority

**Description:** Add the admitted fixture definition to VISION-007 through VISION-010 runtimes,
focused regressions, inventories, requests, results, source/crop PNGs, and reports. Materialize in
dependency order only after the temporary rehearsal passes.

**Acceptance criteria:**

- The new source and crops are deterministic and public synthetic data.
- Structure contains exactly one eligible text-region candidate; OCR contains exactly one
  exact-text observation; spatial output contains complete Cartesian coverage and one positive
  eligible edge.
- The original three source/crop and preprocessing/structure/OCR/spatial case request/result bundles remain byte-identical; renderer-bound truth re-signing and aggregate inventory/report updates are reviewed explicitly.

**Verification:** Run `test`, `materialize:fixtures` where required, and `validate:fixtures` for
each of the four packages; compare original-case hashes to the pre-cutover snapshot.

**Dependencies:** Task 2.

**Likely touched areas:** `tools/visual-preprocessor`, `tools/visual-structure-extractor`,
`tools/visual-ocr-observer`, `tools/visual-spatial-observer`, and their corresponding `eval/`
authority directories.

### Task 4: Extend truth diagnostics and machine review

**Description:** Extend VISION-011 through VISION-013 authority for the same fixture. The current
AI agent directly inspects the committed crop before authoring the machine-review receipt; the
receipt remains `ai_agent`, `humanReviewed=false`, and `synthetic_fixture_diagnostic`.

**Acceptance criteria:**

- OCR truth reports one exact positive match without upgrading truth to human or production
  authority.
- Text-region truth reports one unique positive coverage match.
- Machine-review receipt binds the actual crop bytes, records visible observations and limits,
  and cannot project delivery trust or human identity.

**Verification:** Run each focused test, canonical materialization, semantic validation, and
direct image inspection; recompile reports from current authority bytes.

**Dependencies:** Task 3.

**Likely touched areas:** `tools/visual-ocr-diagnostics`,
`tools/visual-text-region-diagnostics`, `tools/visual-machine-review`, and corresponding `eval/`
authority directories.

### Task 5: Publish the positive association

**Description:** Extend the VISION-014 definition, request, result, inventory, and report with the
new case. Keep the geometry-only bidirectional-uniqueness policy unchanged.

**Acceptance criteria:**

- The result selects exactly one candidate-observation-measurement triple.
- The report retains the original unavailable/unmatched outcomes and adds exactly one matched
  synthetic case with availability-aware metrics.
- Text, confidence, truth, layout, semantics, Track, readiness, trust, approval, live, and cloud
  fields cannot influence association selection.

**Verification:** Run focused association tests and canonical replay, including positive,
unmatched, unavailable, many-to-one, one-to-many, hash/path/alias, TOCTOU, and staged-tamper cases.

**Dependencies:** Task 4.

**Likely touched areas:** `tools/visual-ocr-region-association` and
`eval/visual-ocr-region-association`.

## Checkpoint: Canonical authority coherence

- All eight package test and validation commands pass on the same working tree.
- Original three source/crop and preprocessing/structure/OCR/spatial/association case request/result bundles remain unchanged. Renderer-bound truth files re-sign against the current renderer source hash; inventories/reports add the fourth case and therefore receive new hashes.
- No partial authority, copied inventory, alternate root, live provider, or cloud egress is used.
- `git diff --check` passes and the full intended write set is reviewed before commit.

## Phase 4: Repository integration and closeout

### Task 6: Integrate repository gates and truth documentation

**Description:** Update asset validation, hotspot wiring, README status, strategy baselines,
decision log, and execution evidence to describe the fourth case and its strict acceptance
boundary. Do not add a Track B runtime or `FigureUnderstandingResult`.

**Acceptance criteria:**

- Canonical assets are schema- and semantic-recompiled by `validate:assets`.
- The hotspot runs all VISION-015 focused tests and canonical replay.
- Documentation says synthetic positive association plumbing, not real association acceptance or
  Track B completion.

**Verification:** Strategy/README consistency search, asset gate, hotspot, and `git diff --check`.

**Dependencies:** Task 5.

**Likely touched areas:** `tools/rule-compiler`, `scripts/check-toolchain.ps1`, `README.md`,
`docs/strategy`, and `docs/change-evidence`.

### Task 7: Run fixed-order final verification and review

**Description:** Execute the complete repository gate order on the final working tree, inspect
the complete diff for authority or boundary regressions, and commit the atomic implementation and
evidence only after fresh evidence is available.

**Acceptance criteria:**

- Build, tests, assets, cross-subject validation, and hotspot all exit zero in fixed order.
- Review finds no unresolved blocking or important issue and no secret or local configuration in
the write set.
- Evidence records commands, exit codes, key counts, N/A items, residual risk, rollback commits,
  and `repo-side done` versus gateway/workflow/live boundaries.

**Verification:**

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `npm --prefix tools/rule-compiler run validate:cross-subject`
5. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

**Dependencies:** Task 6.

**Likely touched files:** Evidence only after implementation stabilizes.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OCR output varies by package or model | High | Bind package/model hashes and stop before authority edits if the probe is not exact and repeatable. |
| Fixture is tuned to extractor internals | High | Require independent renderer truth, OCR exact match, region coverage, and direct visual review; do not add case-specific extractor branches. |
| Upstream definition change breaks downstream inventories | High | Rehearse externally, then perform one atomic canonical cutover and run all stage validators before commit. |
| Positive diagnostic is mistaken for production quality | High | Preserve synthetic scope, negative dispositions, controls, eligibility, and explicit non-goals in schemas, semantic validators, README, and evidence. |
| Existing fixture bytes drift during materialization | High | Snapshot original source/crop and case request/result bytes and fail on drift; separately verify the expected renderer-bound truth re-signing and aggregate inventory/report updates. |
| Runtime grows harder to maintain | Medium | Avoid unrelated refactoring in VISION-015; schedule module extraction separately after behavior is closed. |

## Open questions

None. A failed risk probe is a defined stop condition rather than a request to weaken authority.

## Rollback

Revert the VISION-015 evidence and atomic implementation commits, then the planning commits if the
feature is abandoned. Preserve every pre-existing VISION-007 through VISION-014 artifact, `.env`,
OCR environment, gateway setting, delivery/review authority, readiness receipt, and sample
authority.
