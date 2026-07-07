# Math Answer Eval

This dataset exercises the shared markdown validator and delivery pipeline for
the `math-answer` subject pack.

## Coverage

- `linear-equation-smoke`: positive smoke case with classroom and compact
  visual baselines
- `unbalanced-dollar`: negative hard gate that confirms unbalanced math
  delimiters are rejected
- `basic-statistics-summary`: positive math-specific fixture that keeps
  average/median/mode conclusions explicit for a text-grounded data-list case,
  then verifies validator/render/deliver behavior with classroom and compact
  visual baselines
- `stepwise-derivation`: positive derivation case that keeps equivalent-transform
  steps explicit and records classroom/compact visual baselines
- `basic-probability-notation`: positive math-specific fixture that keeps
  standard `$P(A)=\frac{m}{n}$` notation explicit for text-grounded probability
  answers, then verifies validator/render/deliver behavior with classroom and
  compact visual baselines
- `function-graph-review-fallback`: positive fallback fixture that carries a
  compact `【疑】` marker for graph-dependent items without pretending real graph
  reading is automated
- `geometry-review-fallback`: positive fallback fixture that carries a compact
  `【疑】` marker for geometry-dependent items without pretending real geometry
  reasoning is automated
- `chart-driven-review-fallback`: positive fallback fixture that carries a
  compact `【疑】` marker for chart/data-driven items without pretending real
  chart interpretation is automated

## Output

The runner writes `results/latest.json` next to the dataset after each eval run.
