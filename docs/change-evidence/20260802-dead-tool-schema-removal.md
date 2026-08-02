# 2026-08-02 dormant tool and schema removal evidence

## Scope

- Removed 24 frozen tool directories, their 23 dedicated eval/fixture directories, and the obsolete `ai-gateway` TrackResult vision probe.
- Removed 87 schemas with no reachable retained consumer.
- Retained only the answer-generation/layout modules: spec assembler, rule compiler, AI answer gateway, LaTeX renderer, optional OCR, and the current WPF shell.
- Retained 12 schemas reachable from subject packs, snapshots, renderer contracts, delivery manifests, and current compatibility validation.

## Consumer proof

- Before deletion, scanned retained workflow, scripts, packages, tests, WPF source, subject packs, and active strategy files for frozen tool/eval paths.
- Frozen tools referenced one another but had no current live workflow, renderer, compiler, OCR, or WPF execution consumer.
- `tools/ai-gateway/vision-request.mjs` was used only by its own TrackResult test/probe and was not used by `run-live-answer-workflow.ps1`.
- Schema reachability started from filenames referenced by retained code/config/tests and recursively followed schema `$ref` edges.
- Delivery manifest, review-state compatibility, data classification, and placed-answer-graphic compatibility schemas were retained because current renderer paths still consume them.

## Change inventory

- 340 tracked frozen tool/eval/probe files removed.
- 87 unreachable schema files removed.
- schema validation surface reduced from 99 to 12 files.
- `tools/ai-gateway/package.json` no longer exposes `request:vision` or `test:vision`.

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0 | 12 schemas, 3 subject packs, assemblies, snapshots, and renderer contracts |
| `npm --prefix tools/ai-gateway run test:answer` | exit 0 | 17/17 passed |
| `dotnet build ClassroomToolkit.sln -c Debug -p:UseSharedCompilation=false` | exit 0 | 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0 | 46/46 passed |
| `scripts/check-toolchain.ps1 -Mode Full` | exit 0 | cross-subject, PDF delivery smoke, and all three subject-pack evals; 206.01 s |

## Truth boundary

- This is repository cleanup only; it does not improve blind-answer accuracy or establish teacher acceptance.
- No cloud/provider request, WPF process operation, `.env` change, user-exam change, or delivery-asset change occurred.
- Optional legacy fields accepted by the current delivery-manifest compatibility reader were not removed without a versioned migration.
- WPF DTO/diagnostics cleanup and the empty Interop project are intentionally deferred to ARCH-102.

## Rollback

- Restore only the deleted tracked paths, orphan schemas, and the two removed AI gateway package scripts from Git history.
- Do not restore frozen modules into the active gate or roadmap without satisfying the re-enable criteria in `product-core-simplification.md`.
