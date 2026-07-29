# VISION-016 Implementation Plan

## Goal

Implement the approved public synthetic semantic-role projection diagnostic. The slice must
project `measurement_reading` only when an independent declaration and the current VISION-011,
VISION-012, and VISION-014 authorities form one exact truth-label/observation/candidate evidence
triangle. It must not create figure understanding, a Track B result, an answer candidate, trust,
or live acceptance.

## Dependency graph

`schemas -> projector core -> focused mutations -> canonical materialization -> asset boundary -> hotspot/docs/evidence -> fixed gates`

The upstream visual packages remain immutable inputs. VISION-016 may bind their bytes but may not
re-materialize or rewrite them.

## Phase 1: Contract foundation

### Task 1: Add the five semantic projection schemas

**Description:** Define declaration, request, result, case-inventory, and report contracts with
closed fields, stable IDs, public synthetic classification, fixed negative dispositions, and no
answer/Track/trust surface.

**Acceptance criteria:**

- Declaration contains only the truth-label role authority and crop/truth provenance.
- Result can express exactly one proven projection and fixes all acceptance, Track, trust, WPF,
  live, controls, and eligibility fields to negative values.
- Inventory/report require non-empty coverage and expose counts, not production quality metrics.

**Verification:** Parse every schema and validate positive/negative in-memory examples through the
repository schema validator during the asset-boundary phase.

**Dependencies:** Approved VISION-016 runtime plan.

**Files likely touched:** Five `prompts/shared/schemas/visual-*-semantic-*.schema.json` files.

**Estimated scope:** Medium.

## Checkpoint: Contract shape

- The five schemas contain no optional positive acceptance path.
- Schema titles, IDs, compatibility metadata, kinds, and enum values are internally consistent.
- `git diff --check` passes.

## Phase 2: Core projection runtime

### Task 2: Build canonical authority loading and evidence-triangle projection

**Description:** Add a Python projector using the prepared OCR environment and existing visual
package authority patterns. It loads only the fixed canonical root, snapshots all upstream bytes,
validates case/subject/crop/hash identity, resolves the two truth matches and one association, then
copies recognized text from the bound OCR observation.

**Acceptance criteria:**

- Canonical positive input yields exactly one `measurement_reading` projection for text `12`.
- Role comes only from the declaration; recognized text comes only from the OCR observation.
- Alternate roots, output inside the repository, aliases, upstream drift, and endpoint mismatch
  fail closed.

**Verification:** Focused unit tests for positive projection, source separation, and core authority
mutations.

**Dependencies:** Task 1.

**Files likely touched:** `tools/visual-semantic-projector/visual_semantic_projector.py`, focused
test, `run.ps1`, and `package.json`.

**Estimated scope:** Medium.

### Task 3: Complete mutation, replay, and report coverage

**Description:** Extend focused tests and compiler functions for declaration/request/result,
inventory/report replay, TOCTOU, staged-output tamper, computed fields, negative dispositions, and
atomic external output.

**Acceptance criteria:**

- Missing, duplicate, unmatched, unavailable, ambiguous, or crossed triangle endpoints fail.
- Hash/path/physical identity/crop/schema/disposition/computed-field mutations fail.
- Canonical validation and two independent materializations are byte-exact.

**Verification:** `npm --prefix tools/visual-semantic-projector test` and temporary-tree
materialization comparison.

**Dependencies:** Task 2.

**Files likely touched:** Projector runtime, focused test, tool README, and schema-boundary module.

**Estimated scope:** Medium.

## Checkpoint: Runtime safety

- Focused tests pass without weakening existing upstream validators.
- No VISION-007 through VISION-015 file changes.
- Projector runtime writes only to an external sibling-temp destination.

## Phase 3: Canonical diagnostic authority

### Task 4: Materialize and validate the admitted semantic case

**Description:** Commit one declaration, request, expected result, inventory, and report under a
new evaluation root, plus a concise scope README.

**Acceptance criteria:**

- Inventory admits only `junior-readable-measurement` and binds every canonical artifact hash.
- Expected result contains one projection linking `truth-label-001`, `ocr-observation-001`,
  `text-region-001`, and `ocr-region-association-001` with recognized text `12`.
- Report contains one projected case and no accuracy/acceptance claim.

**Verification:** Canonical fixture validator and byte-exact temporary materialization replay.

**Dependencies:** Task 3.

**Files likely touched:** `eval/visual-semantic-projection/README.md` and five JSON assets.

**Estimated scope:** Medium.

## Checkpoint: Canonical coherence

- Focused suite and canonical validator pass on the same tree.
- `git status` confirms no upstream visual authority drift.
- The canonical result and report preserve all negative dispositions.

## Phase 4: Repository integration

### Task 5: Integrate asset validation and hotspot execution

**Description:** Register all five schemas/assets in `validate:assets`, add schema-level mutation
guards, add the focused test and fixture validator to the hotspot, and extend the cross-subject
contract only where a new stable tool/schema surface must be asserted.

**Acceptance criteria:**

- Asset validation checks every declaration/request/result/inventory/report file and rejects
  positive boundary mutations.
- Hotspot runs projector tests and canonical validation after its VISION-011/012/014 prerequisites.
- Existing asset counts and snapshot semantics remain otherwise unchanged.

**Verification:** `validate:assets`, `validate:cross-subject`, focused package commands, and a
targeted hotspot wiring search.

**Dependencies:** Task 4.

**Files likely touched:** `tools/rule-compiler/validate-assets.mjs`, projector boundary module,
`scripts/check-toolchain.ps1`, and cross-subject tests if required.

**Estimated scope:** Medium.

### Task 6: Synchronize repository truth and execution evidence

**Description:** Add VISION-016 to the execution backlog, implementation roadmap/plan, PRD,
baseline, decision log, README status, tool/eval READMEs, and one dated evidence record. Correct
only directly affected current-state descriptions; preserve historical slice statements.

**Acceptance criteria:**

- Documentation says synthetic semantic-role projection prerequisite, not Track B completion.
- Evidence records focused and fixed-gate results, N/A items, authority preservation, rollback,
  and repo-side versus workflow/live boundaries.
- D-034 records the explicit-declaration/evidence-triangle decision.

**Verification:** Consistency search, `git diff --check`, and full write-set review.

**Dependencies:** Task 5.

**Files likely touched:** `README.md`, selected `docs/strategy` files, and one
`docs/change-evidence` record.

**Estimated scope:** Medium.

## Phase 5: Review and closeout

### Task 7: Run five-axis review and fixed-order verification

**Description:** Review tests first, then implementation for correctness, readability,
architecture, security, and performance. Resolve every blocking or required finding, scan for
secrets, and execute the complete repository gates on the final tree.

**Acceptance criteria:**

- No unresolved blocking or required review finding.
- Build, tests, assets, cross-subject validation, and hotspot all exit zero.
- Implementation and evidence are committed separately; worktree is clean.

**Verification:**

1. `dotnet build ClassroomToolkit.sln -c Debug`
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
3. `npm --prefix tools/rule-compiler run validate:assets`
4. `npm --prefix tools/rule-compiler run validate:cross-subject`
5. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`
6. `git diff --check` and staged secret/write-set review

**Dependencies:** Task 6.

**Files likely touched:** Evidence only after implementation stabilizes.

**Estimated scope:** Small.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Semantic role is inferred from pixels or fixture name | High | Require an independent declaration and verify role-source separation in tests. |
| Crossed endpoints still produce a projection | High | Resolve the truth/observation/candidate triangle by exact IDs and require one matching association. |
| Diagnostic is mistaken for Track B completion | High | Omit FigureUnderstanding/ProblemEvidence/Track/answer fields and schema-fix negative dispositions. |
| Upstream authority changes during projection | High | Snapshot every input before work and recheck before atomic promotion. |
| New validator duplicates runtime inconsistently | Medium | Keep Node boundary checks schema-focused and make the Python canonical validator the semantic authority. |
| Full hotspot runtime increases | Medium | Keep one admitted semantic case and avoid new OCR inference; reuse committed upstream bytes only. |

## Open questions

None. The approved design fixes the only semantic role, authority inputs, output boundary, and
failure behavior for this slice.

## Rollback

Revert the VISION-016 evidence and implementation commits, then its planning and design commits if
the feature is abandoned. Preserve VISION-007 through VISION-015 bytes, `.env`, OCR environment,
gateway settings, visual-evidence and delivery/review authorities, readiness receipt, WPF state,
and canonical sample authority.
