# FLYWHEEL-004 Synthetic Feedback Parse Evidence

## Goal and boundary

- current landing point: FLYWHEEL-003 produces current-authority-valid synthetic scoring records but no executable feedback parse result.
- target landing point: compile one source-byte-bound `FeedbackParseResult` from a non-exact, fixture-labelled synthetic scoring run.
- excluded: teacher free-text parsing, semantic answer grading, archived-authority verification, `OptimizationCandidate`, bucket release metrics, WPF integration, cloud egress, real papers, and live acceptance.

## Behavior

- the source file must pass `SampleRunRecord` shape, semantic, and current canonical authority verification.
- only scoring, non-exact, detected `negative_candidate_fixture` labels are admitted.
- fixture severity and confidence are descriptor fields bound by the canonical index SHA-256 chain.
- the base negative-candidate schema remains additive; canonical feedback-capable descriptors are required by assets/compiler semantics to provide valid severity/confidence and coherent primary/contributing errors.
- output binds source run raw bytes plus index/package/descriptor hashes.
- one `auto_collected feedback-record` projects primary/contributing errors, confidence, severity, evidence, and repro identity.
- createdAt must be an explicitly supplied canonical UTC ISO-8601 timestamp.
- optimization refs remain empty and the fixed stop reason is `feedback_recorded_no_optimizer`.
- direct-path and physical-identity output aliases fail closed before sibling-temp rename.
- output must remain outside the canonical sample root and cannot canonical-path or hardlink-alias any source run, index, package, descriptor, candidate, problem, or truth authority input.

## Increment evidence

| Check | Result |
| --- | --- |
| focused tests | 24 passed / 1 platform symlink skip |
| assets | 50 files / 3 subject packs / 3 snapshots passed |
| independent review | no blocker after canonical-authority output protection and admission coverage fixes |
| build | passed with 0 warnings / 0 errors using the existing task-local exact SDK 10.0.301 |
| .NET tests | 114/114 passed |
| cross-subject | passed |
| hotspot | passed: vision 6/6, DecisionRecord 11/11, aggregate 59/59, sample flywheel 24 passed / 1 platform skip, renderer/eval/OCR passed |
| gateway config | local config valid; cloud egress disabled |
| data boundary | fully synthetic public fixture; no real paper or cloud egress |

## Acceptance boundary

- `repo-side done`: implementation, review, fixed-order full gates, and evidence complete; commit and push remain pending at this evidence capture.
- `gateway verified`: unchanged; offline gateway config/contracts only, no live probe.
- `workflow integrated`: synthetic sample-run to feedback parse only; no optimizer, WPF, answer generation, or teacher feedback UI.
- `live accepted`: false.
- `still open`: teacher parser, semantic attribution, archived authority, OptimizationCandidate, bucket metrics/gates, real controlled samples, generated candidates, workflow integration, and live acceptance.
- rollback: revert only the FLYWHEEL-004 commit for repository changes; inventory and remove operator-selected CLI outputs separately.

## N/A

- check: live primary/fallback gateway probes.
- reason: FLYWHEEL-004 is fully synthetic and offline; it does not change gateway routing and cloud egress remains disabled.
- alternative_verification: gateway config validation and hotspot contract suites.
- evidence_link: `docs/change-evidence/20260726-feedback-parse-result.md`.
- expires_at: when feedback parsing first consumes a live generated candidate or changes gateway behavior.
- recovery_condition: explicit cloud-egress approval plus synthetic/redacted first probes for primary, fallback, and forced-primary-failure.

- check: inherited sample-run symlink-escape fixture.
- reason: the current Windows host rejects unprivileged symlink creation with `EPERM`.
- alternative_verification: FLYWHEEL-003 realpath containment review, absolute/parent escape tests, and passing hardlink physical-identity tests.
- evidence_link: `docs/change-evidence/20260726-synthetic-sample-flywheel.md`.
- expires_at: next run on a host with symlink creation permission.
- recovery_condition: Developer Mode/elevated symlink capability or a non-Windows CI runner is available; rerun the sample-flywheel suite and require no symlink skip.
