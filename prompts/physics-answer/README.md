# Physics Answer Prompt Assets

This directory is the start of the structured prompt asset layout.

Current state:

- The full authoritative human-readable production spec is still the repository-root file:
  - `初中物理试卷参考答案生成与渲染交付提示词_v8.6_生产完整版.md`
- Runtime delivery behavior is beginning to move into structured assets:
  - render profiles under `tools/latex-renderer/profiles/`
  - baseline validation gates in `tools/latex-renderer/validate-answer-markdown.mjs`
  - distilled structured runtime rules in `config.json`

Planned steady-state layout:

- `spec.md`: current full production spec
- `config.json` or future `config.yaml`: structured rules directly consumed by tools
- `checklists/acceptance.md`: distilled acceptance gates
- `evals/`: fixed regression samples and expected checks
- future structured config: style/profile/output rules consumed by tools

Until the full migration is complete, treat the root `v8.6` file as the source of truth for wording and policy.
