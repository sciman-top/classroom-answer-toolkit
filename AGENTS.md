# Repository Guidelines

## 1. Scope

This repo guide inherits `GlobalUser/AGENTS.md v9.54`. Rule order is `runtime/code facts > repo AGENTS > global defaults`. Keep this file repo-specific; long strategy and product prose belong in `docs/strategy/`.

## A. Truth Surfaces

- `docs/strategy/` is the planning and execution truth. Read `README.md`, `product-prd.md`, and `final-implementation-baseline.md` first.
- `prompts/specs/` is the human spec truth. Edit only `platform/`, `commons/`, and `subjects/`.
- `prompts/specs/compiled/` and `prompts/<subject-pack>/spec.md` are generated artifacts; do not hand-edit them.
- `snapshot` is the runtime truth for delivery, validation, and diagnostics.

## B. Repo Structure & Gates

- `src/`: WPF app, orchestration, domain, and infrastructure.
- `tests/`: xUnit and contract coverage.
- `prompts/`: subject-pack assets, rules, configs, profiles, and shared schemas.
- `tools/`: `latex-renderer`, `rule-compiler`, `ocr`, and experimental `answer-graphics`.

Gate order is fixed: `build -> test -> contract/invariant -> hotspot`.

- `powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1`
- `dotnet build ClassroomToolkit.sln -c Debug`
- `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
- `npm --prefix tools/rule-compiler run validate:assets`
- `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`

## C. Change Boundaries

- Use 4-space indentation.
- Keep .NET identifiers in `PascalCase` and locals in `camelCase`.
- Keep subject-pack and tool IDs kebab-case, for example `junior-physics-answer`.
- Root planning `.md` files are jump shells only; do not move authoritative strategy text back to the repo root.
- Do not re-promote `tools/answer-graphics` into the default product promise without updating strategy docs and decision records.

## D. Commit & Evidence

- Use focused commits with concise Chinese subjects, for example `docs: 调整外置参考仓分层`.
- Final handoff must state scope, verification commands, and rollback surface.
- Docs-only changes may use lightweight verification. Schema, runtime, renderer, or WPF behavior changes must rerun the full gate.
