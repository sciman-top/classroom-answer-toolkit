# Math Answer Eval Cases

This directory stores the fixed fixtures referenced by
`eval/math-answer/dataset.json`.

- `linear-equation-smoke`: positive smoke fixture that exercises shared
  validation, render, deliver, and visual-baseline plumbing for the
  experimental `math-answer` pack.
- `unbalanced-dollar`: negative hard-gate fixture that confirms the shared
  markdown validator rejects broken math delimiters for `math-answer` too.
- `stepwise-derivation`: positive math-specific fixture that keeps equivalent
  transforms explicit, then verifies validator/render/deliver behavior with
  classroom and compact visual baselines.
- `basic-probability-notation`: positive math-specific fixture that keeps
  standard probability notation explicit for a text-grounded case, then
  verifies validator/render/deliver behavior with classroom and compact visual
  baselines.
