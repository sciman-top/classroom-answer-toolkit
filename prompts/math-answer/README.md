# Math Answer Prompt Assets

`prompts/math-answer/` is the canonical prompt-asset root for the experimental
junior-math scaffold used to verify that platform contracts are not physics-only.

## Current baseline

- Human-readable compiled spec: `../specs/compiled/试卷参考答案交付规范-初中数学-完整版-v0.1.md`
- Mirrored in-repo prompt spec: `spec.md`
- Structured runtime config consumed by tools: `config.json`
- Asset manifest and ownership map: `manifest.json`
- Acceptance gates distilled from the current experimental scope: `checklists/acceptance.md`
- Fixed eval dataset and visual baselines: `../../eval/math-answer/`

## Directory contract

- `spec.md`: synced mirror of the current compiled experimental math spec
- `config.json`: tool-facing structured rules and profile defaults
- `manifest.json`: asset metadata, authoritative paths, and eval/tool bindings
- `checklists/acceptance.md`: distilled hard gates and review reminders

## Change policy

1. Update the source layers under `prompts/specs/platform|commons|subjects/` first when wording or policy changes.
2. Rebuild the compiled spec and `spec.md` mirror through the assembler before editing tool-facing assets.
3. Add or update a fixed case under `eval/math-answer/` whenever the change affects validation, rendering, or delivery behavior.

## Current scope boundary

This pack is still experimental. It currently proves shared validator, render,
delivery, snapshot, diagnostics, and eval contracts across a non-physics
subject, but it does not yet claim full junior-math production coverage.
