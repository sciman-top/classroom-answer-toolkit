# Repository Guidelines

## Project Structure & Module Organization

- `src/`: WPF app and .NET orchestration layers (`ClassroomToolkit.App`, `Application`, `Services`, `Infra`, `Domain`).
- `tests/`: xUnit + FluentAssertions tests. Toolchain and contract tests live under `tests/ClassroomToolkit.Tests/Toolchain/`.
- `prompts/`: subject-pack assets, rules, configs, profiles, and shared schemas.
- `prompts/specs/`: human-readable spec truth. Edit `platform/`, `commons/`, and `subjects/`; treat `compiled/` and `prompts/<subject-pack>/spec.md` as generated artifacts.
- `tools/`: Node-based toolchains such as `latex-renderer`, `rule-compiler`, `ocr`, and experimental `answer-graphics`.
- `docs/strategy/`: planning and implementation truth. Read `README.md`, `product-prd.md`, and `final-implementation-baseline.md` before making roadmap-level changes.

## Build, Test, and Development Commands

- `powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1`: install local prerequisites and initialize toolchains.
- `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`: full repo gate; run this before claiming completion.
- `dotnet build ClassroomToolkit.sln -c Debug`: build the desktop app and supporting libraries.
- `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`: run the .NET test suite.
- `npm --prefix tools/rule-compiler run validate:assets`: validate subject-pack assets, snapshots, and schemas.
- `npm --prefix tools/latex-renderer run deliver -- "<answer.md>"`: render answer Markdown to PDF/review artifacts.

## Coding Style & Naming Conventions

- Use 4-space indentation in C#, PowerShell, JSON, and Markdown.
- Follow existing .NET naming: `PascalCase` for types/methods, `camelCase` for locals/parameters.
- Keep subject-pack and tool IDs kebab-case, for example `junior-physics-answer`.
- Do not hand-edit generated artifacts under `prompts/specs/compiled/` or mirrored `spec.md` files.

## Testing Guidelines

- Add or update xUnit tests with every behavioral or contract change.
- Prefer targeted tests near the affected area, then rerun the full `dotnet test` and `check-toolchain.ps1`.
- For schema or asset changes, include `validate:assets`; for rendering changes, include relevant `latex-renderer` smoke/eval commands.

## Commit & Pull Request Guidelines

- Follow the current history style: concise Chinese subjects with optional prefixes, such as `docs: 收口规划真值面` or `test: 补 math-answer smoke`.
- Keep each commit focused on one logical change.
- PRs should state scope, affected truth surfaces (`docs/strategy`, `prompts/specs`, schemas, toolchain), and exact verification commands.
- Attach screenshots only for WPF/UI-visible changes; otherwise prefer command and artifact evidence.

## Repository-Specific Guardrails

- `docs/strategy/` is the planning truth; root-level planning files are jump shells only.
- `snapshot` is the runtime truth, not large Markdown specs.
- Do not promote experimental `tools/answer-graphics` back into the default delivery promise without updating ADRs and strategy docs.
