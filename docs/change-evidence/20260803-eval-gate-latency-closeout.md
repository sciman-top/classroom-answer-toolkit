# Eval gate latency closeout — 2026-08-03

## Scope and root cause

- Trigger: coding feedback was still perceived as slow after removing duplicate outer gates.
- Baseline Full evidence at revision `96a38b4`: 227.78s, with three answer evals consuming about 203s (89% of Full).
- Reproduced hotspot: `math-answer` eval took 112.28s on the current workstation.
- Runtime inventory across three subjects: 70 profile executions, 70 repeated snapshot compiles, 30 visual pipelines, and 26 delivery pipelines. Render/review subprocesses independently cold-started browsers.
- Test-overlap finding: math executed the same no-graphics delivery contract for 14 case/profile pairs. Only the two-profile smoke case added distinct delivery coverage; the other 12 retained independent validator and visual assertions.
- Governance finding: active backlog carried 128 lines / 10,723 bytes of detailed instructions for seven already-verified tasks.

## Changes

- `eval-answer-fixtures.mjs` caches compiled snapshots by profile and launches at most one Playwright browser server per subject eval.
- Child render/review processes connect to that local server; standalone CLI calls still launch and close their own browser.
- Child tool execution is asynchronous so the parent Playwright server remains responsive.
- Eval output reports profile, snapshot, browser-server, visual-pipeline, and delivery-pipeline counts.
- A behavior regression test proves two validator-only cases sharing one profile compile one snapshot and launch no browser.
- Math keeps all 16 profile validator runs and 14 visual pipelines, while duplicate no-graphics delivery pipelines drop from 14 to 2.
- The active backlog is reduced to a verified ledger and blocked `VISION-101`; detailed completed-task history remains available at Git revision `96a38b4` and in change evidence.

## Measured checkpoints

```text
math baseline:                 112.28s
shared browser + snapshot:      90.55s
plus duplicate delivery trim:   61.29s
Fast gate:                       4.09s
Core junior physics:            50.28s gate / 50.84s wrapper
```

Math improved by 45.4% from the reproduced baseline while retaining all validator and visual cases. Core retains eight visual pipelines, six semantically distinct delivery pipelines, and two profiles with one snapshot compile each.

## Final fixed-order verification

```text
dotnet build ClassroomToolkit.sln -c Debug
exit=0; warnings=0; errors=0; wrapper elapsed=3.81s

dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build
exit=0; passed=33; failed=0; skipped=0; wrapper elapsed=7.17s

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full
exit=0; gate elapsed=140.05s; wrapper elapsed=140.53s
assets=1; separate spec-boundary=0; eval-runtime-tests=1
cross-subject=1; delivery-smoke=1; subject evals=3
```

Runtime assertions:

```text
junior: profiles=28; snapshots=2; browser servers=1; visual=8; delivery=6
senior: profiles=26; snapshots=2; browser servers=1; visual=8; delivery=6
math:   profiles=16; snapshots=2; browser servers=1; visual=14; delivery=2
```

Full improved from 227.78s to 140.05s, a reduction of 87.73s / 38.5%. The three subject eval steps fell from about 203s total to 114.99s while preserving all three subject suites.

## Boundaries and rejected optimizations

- No subject eval concurrency was introduced. Browser-backed suites remain sequential to avoid multiplying peak browser memory without resource-stability evidence.
- `deliver` remains self-validating; no hidden environment bypass or `--skip-assets` state flag was added merely to save a few seconds.
- No xUnit, validator, visual baseline, cross-subject, renderer-math, or delivery-smoke invariant was removed.
- This is repository verifier latency evidence, not provider/live accuracy or teacher acceptance.

## Audit disposition

- Tests retained: 33 xUnit tests plus focused AI gateway, output-path, renderer-math, spec-boundary, eval-runtime, visual, and delivery behavior checks. Their individual non-browser cost remains seconds or sub-seconds.
- Gate routing retained: local code uses Fast; subject-specific spec/rules use Core; only shared spec/schema/renderer/release changes use Full.
- Setup is not a gate: `scripts/bootstrap.ps1` may validate assets after installation but remains outside daily verification.
- No repository GitHub workflow or hook duplicates the local gate (`.github` files=0, `.githooks` files=0).
- Active strategy is 11 indexed files / 487 lines. Active backlog fell from 128 lines / 10,723 bytes to 25 lines / 2,381 bytes; verified task detail remains traceable rather than active.

## Rollback

Revert only this task's runner, focused test, math expectation, backlog, and documentation changes. Do not alter provider configuration, user assets, real-paper evidence, or formal deliveries.
