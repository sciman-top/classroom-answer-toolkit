# Physics Answer Eval Suite

This directory stores fixed regression assets for the `physics-answer` prompt and
render workflow.

## Layout

- `dataset.json`: suite index and canonical case list
- `cases/*.md`: fixed answer-markdown fixtures
- `cases/*.expected.json`: expected validator outcomes per profile
- `baselines/visual/`: tracked visual baselines used by smoke regression
- `results/`: generated local run outputs, not committed except the README

## Current scope

- validator smoke coverage
- shared smoke fixture for render/review
- first-page visual baseline for classroom profile

## Run

```powershell
npm --prefix tools/latex-renderer run eval:answer
```

Add a new case here whenever a prompt/config/tool change alters validation,
rendering, or classroom-readability behavior.
