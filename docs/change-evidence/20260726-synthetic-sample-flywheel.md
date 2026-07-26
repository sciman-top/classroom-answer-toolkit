# FLYWHEEL-003 Synthetic Sample Flywheel Evidence

## Goal and boundary

- current landing point: sample schemas exist, but no sample index, structured package, or executable run compiler exists.
- target landing point: execute one fully synthetic plumbing run and one gate-controlled perturbed-negative scoring run, producing `SampleRunRecord` objects that pass the repository's limited shape validator and compiler semantic invariants.
- excluded: real papers, semantic answer grading, feedback parsing, `OptimizationCandidate`, grey release, WPF integration, cloud egress, and live acceptance.

## Behavior

- `样例交付/index.json` is the non-overridable canonical authority; public CLI/API callers cannot inject alternate index/package paths.
- each index entry binds `subjectPack / packageRef / packageSha256`; the package must resolve exactly to `structured/<subjectPack>/<sampleId>/sample.json`, match the recorded SHA-256, and agree on subject.
- `candidateBindings` bind every indexed negative-candidate descriptor by path and SHA-256; scoring records bind the selected descriptor hash before projecting candidate type or fixture root cause.
- sample and subject IDs are restricted to one lowercase kebab-case path segment; assets validation checks every descriptor points to a package-declared negative artifact and indexed reference truth.
- `.gitattributes` fixes hash-bound sample JSON/Markdown assets to LF across checkouts.
- index refs remain under the canonical sample package root; package/candidate refs remain under the package root after realpath resolution, so absolute, parent, and symlink escapes fail closed.
- the compiler cross-checks index classification, expected question inventory, and problem/truth/annotation refs against the structured package.
- all runs require explicit truth extraction and leakage states; plumbing emits no diff, root cause, unsupported truth tier, or optimization signal.
- scoring requires an indexed non-placeholder candidate, `truthExtractionStatus=ok`, and no unresolved leakage.
- current scoring compares candidate/reference raw-byte SHA-256 only and records the synthetic negative-candidate label as expected root cause.
- each record binds canonical index/package/descriptor SHA-256 values and passes the repository's limited shape validator, compiler semantic invariants, and current canonical authority bytes verification; arbitrary archived-authority verification is not implemented.
- output uses sibling-temp rename and rejects canonical-path, symlink, and existing-file-identity aliases before writing.

## Increment evidence

| Check | Result |
| --- | --- |
| sample-flywheel focused tests | 16 passed / 1 platform skip on 2026-07-26; hardlink identity passed, symlink creation unavailable with Windows `EPERM` |
| plumbing fixture | flow recorded with no diff or optimization refs |
| scoring fixture | perturbed negative recorded with unequal SHA-256 values and `reasoning_error` fixture label |
| fail-closed admission | missing/low-confidence truth state, missing/unresolved leakage state, placeholder candidate, unlisted candidate, caller-controlled authority, malformed record semantics, and path/output aliases are rejected |
| data boundary | all fixture content is synthetic and classified public; no real paper or cloud egress used |
| independent review | final review reported no blocker after P1/P2 authority and relationship fixes |
| build | passed with 0 warnings / 0 errors using the existing task-local exact SDK 10.0.301 |
| .NET tests | 114/114 passed |
| assets | 50 files / 3 subject packs / 3 snapshots passed; includes all canonical sample authority entries |
| cross-subject | passed |
| hotspot | passed: vision 6/6, DecisionRecord 11/11, aggregate 59/59, sample flywheel 16 passed / 1 platform skip, renderer/eval/OCR passed |
| gateway config | local config valid; cloud egress disabled |

## Acceptance boundary

- `repo-side done`: implementation, review, fixed-order full gates, staged authority/hash checks, and evidence complete; commit and push remain pending at this evidence capture.
- `gateway verified`: offline config and gateway contract suites passed; primary/fallback live gateway behavior was not probed.
- `workflow integrated`: partial sample-flywheel plumbing/scoring record only; no semantic grader, feedback parser, optimizer, WPF, or answer-generation integration.
- `live accepted`: false.
- `still open`: archived-authority verification, semantic scoring, FeedbackParseResult, OptimizationCandidate, bucket metrics/gates, real controlled samples, generated candidates, and live acceptance.
- rollback: revert only the FLYWHEEL-003 commit for repository changes. This task's tests create and clean temporary outputs. Operator-selected CLI `--out` files are mutable run artifacts outside Git and must be inventoried and removed separately when rolling back a manual run.

## N/A

- check: live primary/fallback gateway probes.
- reason: FLYWHEEL-003 is a fully synthetic offline sample compiler and does not change AI gateway behavior; cloud egress remains disabled.
- alternative_verification: `npm --prefix tools/ai-gateway run validate:config` plus the repository hotspot gateway suites.
- evidence_link: `docs/change-evidence/20260726-synthetic-sample-flywheel.md`.
- expires_at: when this slice first consumes a live generated candidate or changes gateway routing.
- recovery_condition: obtain explicit cloud-egress approval, use synthetic or redacted media first, and run primary, fallback, and forced-primary-failure probes.

- check: symlink-escape runtime fixture.
- reason: the current Windows host rejects unprivileged symlink creation with `EPERM`.
- alternative_verification: realpath containment implementation review, absolute/parent escape tests, and hardlink physical-identity test.
- evidence_link: `tools/sample-flywheel/sample-run.test.mjs`.
- expires_at: next run on a host with symlink creation permission.
- recovery_condition: Developer Mode/elevated symlink capability or a non-Windows CI runner is available; rerun `npm --prefix tools/sample-flywheel test` and require the symlink case to pass without skip.
