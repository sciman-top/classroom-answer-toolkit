# Physics Answer Eval Suite

This directory stores fixed regression assets for the `junior-physics-answer` prompt and
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
- first-page visual baselines for classroom and compact profiles
- orphan question-number first-line regression
- choice-answer compact-layout hard-gate regression
- classroom long-line warning regression
- classroom long-line visual baselines for classroom and compact layout contrast
- display-math layout visual baselines for heading, formula block, and paragraph rhythm
- answer-graphic placement sample for marker-based figure insertion and delivery validation
- figure-binding sample aligned with v8.11 multi-figure sub-question binding guidance
- necessary-derivation computation sample aligned with v8.9 difficult-subquestion guidance
- instrument-reading-priority sample aligned with v8.10 original-figure-reading guidance
- instrument-range-scale-check sample aligned with v8.12 range/division double-check guidance
- backtick-wrapped math hard-gate regression
- unbalanced LaTeX dollar hard-gate regression

## Run

```powershell
npm --prefix tools/latex-renderer run eval:answer
```

Add a new case here whenever a prompt/config/tool change alters validation,
rendering, or classroom-readability behavior.
