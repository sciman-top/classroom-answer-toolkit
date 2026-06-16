# Physics Answer Prompt Assets

`prompts/physics-answer/` is the canonical prompt-asset root for the junior-high
physics answer workflow.

## Current baseline

- Human-readable production spec: repository-root `v8.12` production file
- Mirrored in-repo prompt spec: `spec.md`
- Structured runtime config consumed by tools: `config.json`
- Asset manifest and ownership map: `manifest.json`
- Acceptance gates distilled from the full spec: `checklists/acceptance.md`
- Fixed regression/eval dataset: `../../eval/physics-answer/`

## Directory contract

- `spec.md`: synced mirror of the current full production prompt spec
- `config.json`: tool-facing structured rules and profile defaults
- `manifest.json`: asset metadata, authoritative paths, and eval/tool bindings
- `checklists/acceptance.md`: distilled hard gates and review reminders

## Change policy

1. Update the repository-root production spec first when wording or policy changes.
2. Sync `spec.md`, `config.json`, and `checklists/acceptance.md` in the same pass.
3. Add or update a fixed case under `eval/physics-answer/` whenever the change
   affects validation, rendering, or delivery behavior.

## Current migration state

The asset layer is now standardized enough for tools to reference stable paths:

- prompt policy lives under `prompts/physics-answer/`
- eval fixtures and visual baselines live under `eval/physics-answer/`
- rendering/runtime code stays under `tools/latex-renderer/`

Further work should extend the structured rules and eval coverage rather than
adding new ad hoc root-level prompt variants.
