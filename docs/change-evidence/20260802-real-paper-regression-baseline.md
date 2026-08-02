# 2026-08-02 real-paper regression baseline evidence

## Scope

- Added hash-bound baselines for the selected 2024 and 2025 Guangzhou physics questions.
- Added an offline verifier and tests under `eval/real-paper/`.
- Reused already completed live runs; no new provider request or exam upload was needed.

## Baseline results

| Baseline | Blind | Visual Audit | Reference Review | Teacher Accepted |
| --- | --- | --- | --- | --- |
| 2024 Q5/Q16/Q17/Q18 | Q5 pass; Q16-Q18 fail | Q5 pass; Q16-Q18 fail | 4/4 pass | false |
| 2025 Q8/Q11/Q12/Q17/Q18 | 5/5 fail | not_run; 5 not_evaluated | 5/5 pass | false |

The 2025 visual-audit state is deliberately `not_run`. Reference-reviewed correctness does not backfill that missing stage.

## Authority and artifact binding

- Each source exam and official reference PDF is bound by a repository-relative path and raw-byte SHA-256.
- Each evaluated stage is bound to the exact Markdown artifact bytes used for that result.
- Metadata contains no copied exam page or answer body.
- The verifier rejects absolute paths, path traversal, missing files, hash drift, incomplete question coverage, invalid stage transitions, and a reference-reviewed baseline with a failed target question.

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `npm --prefix eval/real-paper test` | exit 0 | 3/3 passed, including authority-byte mutation rejection |
| `npm --prefix eval/real-paper run validate` | exit 0 | two baselines and all authority/artifact hashes verified |
| `scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0 | Core completed in 62.26 s before baseline closeout |
| fixed order `build -> test -> validate:assets -> Full` | exit 0 | build 0/0; xUnit 33/33; 12 schemas; Full 267.86 s |

## Truth boundary

- `repo_supported=true`: metadata, verifier, tests, and evidence exist.
- `workflow_integrated=true`: referenced 2024/2025 live artifacts were produced by the repository workflow.
- `reference_reviewed=true`: selected target questions match the official reference-reviewed delivery.
- `teacher_accepted=false`: no teacher acceptance record exists.
- This baseline does not prove a blind visual root-cause fix; it preserves the failures that motivate later work.

## Rollback

- Remove only `eval/real-paper/` and this evidence file.
- Do not delete or alter the referenced user PDFs or delivery artifacts.
