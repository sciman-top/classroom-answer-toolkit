# 2026-08-02 planning, spec, gate alignment evidence

## Scope

- Consolidated the active PRD, baseline, roadmap, implementation plan, and AI-executable backlog around one answer-generation and layout delivery chain.
- Replaced the production common visual-question spec with the Markdown-only v1.1 contract and regenerated the three subject-pack outputs.
- Added a fail-closed spec-boundary verifier and tests for eight frozen implementation terms.
- Added Fast/Core/Full toolchain routing and compatible .NET 10 `10.0.3xx` patch selection.
- Added the domain vocabulary boundary in `CONTEXT.md`.

## Version projection

- junior physics: v8.14 -> v8.15
- senior physics: v1.0 -> v1.1
- math: v0.1 -> v0.2
- common quantitative visual-question contract: v1.0 -> v1.1

## Verification

| Command | Result | Key evidence |
| --- | --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug -p:UseSharedCompilation=false` | exit 0 | SDK 10.0.302; 0 warnings; 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0 | 46 passed; 0 failed |
| `scripts/check-toolchain.ps1 -Mode Fast` | exit 0 | AI tests 17/17; output-path tests 3/3; 3.84 s |
| `scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer` | exit 0 | one-pack snapshots and 14 eval cases; 55.06 s |
| `scripts/check-toolchain.ps1 -Mode Full` | exit 0 | all snapshots, cross-subject contract, PDF delivery smoke, and three-pack eval; 201.19 s |
| `npm --prefix tools/spec-assembler run assemble:all -- --check` | exit 0 | generated specs match assemblies |
| `npm --prefix tools/rule-compiler run test:spec-boundary` | exit 0 | 9/9 passed |
| `npm --prefix tools/rule-compiler run validate:spec-boundary` | exit 0 | 3 assemblies validated; 8 frozen terms excluded |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0 | 99 schemas and 3 subject packs validated |
| frozen-term scan over active source, compiled, and mirrored specs | no matches | production prompt surface excludes frozen evidence-object vocabulary |
| `git diff --check` | exit 0 | no whitespace errors; line-ending conversion warnings only |

## Truth boundary

- This evidence proves repository-side planning/spec/gate alignment only.
- Cloud egress remained disabled. No live provider call was made.
- No WPF application was started or operated; no visible WPF behavior changed in this slice.
- The pre-existing 2024 live workflow changes and their delivery assets remain a separate uncommitted slice under PRE-001.
- 2024 Blind Candidate and Visual Audit still fail on Q16-Q18; Reference Review produces the corrected delivery. Teacher acceptance has not occurred.
- Full gate success is not production/live acceptance.

## Dirty-worktree boundary

- Preserved `.env`, `tmp/pdfs/2024-reference/`, `tmp/pdfs/2024-rootcause/`, and `正式交付/**`.
- Preserved the pre-existing live workflow/gateway/renderer changes and `docs/change-evidence/20260801-live-2024-answer-workflow.md`.
- No commit, push, process restart, system SDK installation, or user-environment mutation was performed.

## Rollback

- Revert only the planning/spec/gate/SDK files and regenerated v8.15/v1.1/v0.2 prompt artifacts in this slice.
- Restore the prior common v1.0 and subject-pack v8.14/v1.0/v0.1 assembly references together; do not hand-edit compiled or mirrored outputs.
- Restore the prior single-mode toolchain script and exact SDK contract only if the associated docs and contract tests are reverted in the same rollback.
