# Math Answer Eval Cases

This directory stores the fixed fixtures referenced by
`eval/math-answer/dataset.json`.

- `linear-equation-smoke`: positive smoke fixture that exercises shared
  validation, render, deliver, and visual-baseline plumbing for the
  experimental `math-answer` pack.
- `unbalanced-dollar`: negative hard-gate fixture that confirms the shared
  markdown validator rejects broken math delimiters for `math-answer` too.
