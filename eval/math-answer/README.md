# Math Answer Eval

This dataset exercises the shared markdown validator and delivery pipeline for
the `math-answer` subject pack.

## Coverage

- `linear-equation-smoke`: positive profile sentinel with classroom and compact
  visual baselines plus one classroom delivery run
- `unbalanced-dollar`: negative hard gate that confirms unbalanced math
  delimiters are rejected
- `basic-statistics-summary`: positive math-specific fixture that keeps
  average/median/mode conclusions explicit for a text-grounded data-list case,
  then verifies the subject-pack validator without duplicating shared layout baselines
- `stepwise-derivation`: positive derivation case that keeps equivalent-transform
  steps explicit and records one classroom visual baseline
- `basic-probability-notation`: positive math-specific fixture that keeps
  standard `$P(A)=\frac{m}{n}$` notation explicit for text-grounded probability
  answers, then records one classroom visual baseline
- `function-graph-review-fallback`: positive fallback fixture that carries a
  compact `【疑】` marker for graph-dependent items without pretending real graph
  reading is automated
- `geometry-review-fallback`: positive fallback fixture that carries a compact
  `【疑】` marker for geometry-dependent items without pretending real geometry
  reasoning is automated
- `chart-driven-review-fallback`: positive fallback fixture that carries a
  compact `【疑】` marker for chart/data-driven items without pretending real
  chart interpretation is automated

Compact snapshot compilation remains part of Full. Only the linear-equation sentinel repeats
visual rendering across both profiles; other fixtures retain the lowest layer that covers their
independent failure mode.

## Output

The runner writes `results/latest.json` next to the dataset after each eval run.
