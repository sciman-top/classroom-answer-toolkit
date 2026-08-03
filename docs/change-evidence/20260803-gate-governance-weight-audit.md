# Gate and governance weight audit — 2026-08-03

## Scope and conclusion

- Scope: active xUnit/Node tests, `scripts/check-toolchain.ps1`, documented gate routing, active strategy surface, and archive reachability.
- Conclusion: the test inventory is proportionate and behavior-oriented; no tests were removed. Two duplicate gate paths and one residual active-strategy document were excessive and have been corrected.
- Product boundary: this evidence proves repository-side gate/governance cleanup only. It does not run a cloud provider, accept a teacher review, or unblock `VISION-101`.

## Findings

| Area | Evidence | Decision |
| --- | --- | --- |
| xUnit | 33 tests, approximately 4 seconds; assertions cover JSON/schema shape and XAML/CLI behavior rather than source-text coupling | retain |
| Focused Node tests | AI gateway 17 tests; renderer output-path 3 tests; renderer math 1 test; positive/negative spec-boundary cases | retain |
| Fast budget | target `<= 60s`; measured 2.72s | retain lightweight routing |
| Core budget | target `<= 120s`; measured 58.36s | retain single-subject routing |
| Full budget | target `<= 360s`; pre-change observation approximately 227s | retain sequential browser-backed eval; no evidence supports parallelization risk |
| Duplicate contract | documented fixed order ran `validate:assets` before Core/Full, while Core/Full ran it again | remove outer duplicate |
| Duplicate boundary | Core/Full ran `validate:spec-boundary`, while `validate:assets` already calls the same invariant | Core/Full use assets once; Fast retains the lightweight boundary-only check |
| Strategy surface | 12 active strategy files / 700 lines included an unindexed historical visual/trust aggregation architecture | archive it; active strategy becomes 11 files / 590 lines |

## Changes

- `scripts/check-toolchain.ps1`
  - Fast runs the focused spec-boundary check and skips complete assets/eval work.
  - Core/Full run `validate:assets` exactly once, then the remaining risk-matched hotspot checks.
  - Subject-pack discovery is deferred until Core/Full need it.
- `AGENTS.md`, `README.md`, and strategy plan/roadmap/backlog now describe `build -> test --no-build -> risk-matched toolchain`, with the complete contract owned by Core/Full.
- `docs/strategy/visual-first-answering-architecture.md` moved to `docs/archive/visual-first-answering-architecture.md`; both archive and strategy indexes point to the historical-only boundary.
- No skip flag or contract-state parameter was added; each gate mode remains independently executable.

## Verification evidence

### Focused routing

```text
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Fast
exit=0; elapsed=2.72s
spec-boundary executed; assets/math/snapshots/cross-subject/delivery-smoke/answer-eval skipped

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer
exit=0; elapsed=58.36s
routing assertion: [Core] assets=1; [Core] spec-boundary=0
AI gateway=17/17; renderer output-path=3/3; renderer math=1/1; junior physics eval passed
```

### Final fixed-order gate

```text
dotnet build ClassroomToolkit.sln -c Debug
exit=0; elapsed=3.29s; warnings=0; errors=0

dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build
exit=0; passed=33; failed=0; skipped=0; elapsed=3s

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full
exit=0; gate elapsed=227.78s; wrapper elapsed=228.40s
routing assertion: assets=1; spec-boundary=0; cross-subject=1; delivery-smoke=1; answer-eval=3
all three subject-pack evals passed
```

## Non-changes and risk decision

- Full remains sequential. Its prior 227-second observation is inside the 360-second budget, while three browser-backed subject evals can contend for memory and process resources. Parallelization without peak-resource/stability evidence would be speculative optimization.
- Full `delivery-smoke` keeps its own standalone delivery asset validation because it proves that each supported delivery invocation is self-contained; it is not the removed outer fixed-gate duplicate.
- Existing behavior/contract tests remain because their cost is low and each protects a current runtime or data-format invariant.

## Rollback

Revert only this change set: restore the previous gate routing/docs and move the archived architecture file back to `docs/strategy/`. Do not revert product assets, provider configuration, teacher-review evidence, or unrelated delivery artifacts.
