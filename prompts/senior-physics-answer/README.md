# Senior Physics Answer Prompt Assets

`prompts/senior-physics-answer/` is the canonical prompt-asset root for the senior-high
physics answer workflow.

## Current baseline

- Human-readable production spec: `../specs/compiled/试卷参考答案交付规范-高中物理-完整版-v1.0.md`
- Mirrored in-repo prompt spec: `spec.md`
- Structured runtime config consumed by tools: `config.json`
- Asset manifest and ownership map: `manifest.json`
- Acceptance gates distilled from the full spec: `checklists/acceptance.md`
- Fixed regression/eval dataset: `../../eval/senior-physics-answer/`

## Directory contract

- `spec.md`: synced mirror of the current full production prompt spec
- `config.json`: tool-facing structured rules and profile defaults
- `manifest.json`: asset metadata, authoritative paths, and eval/tool bindings
- `checklists/acceptance.md`: distilled hard gates and review reminders

## Change policy

1. Update the source layers under `prompts/specs/platform|commons|subjects/` first when wording or policy changes.
2. Rebuild the compiled spec and `spec.md` mirror through the assembler before editing tool-facing assets.
3. Add or update a fixed case under `eval/senior-physics-answer/` whenever the change
   affects validation, rendering, or delivery behavior.

## Current migration state

The asset layer is now standardized enough for tools to reference stable paths:

- prompt policy lives under `prompts/senior-physics-answer/`
- eval fixtures and visual baselines live under `eval/senior-physics-answer/`
- rendering/runtime code stays under `tools/latex-renderer/`

Further work should extend the structured rules and eval coverage rather than
adding new ad hoc prompt variants outside `prompts/specs/`.
