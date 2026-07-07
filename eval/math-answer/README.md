# Math Answer Eval

This dataset exercises the shared markdown validator and delivery pipeline for
the `math-answer` subject pack.

## Coverage

- `linear-equation-smoke`: positive smoke case with classroom and compact
  visual baselines
- `unbalanced-dollar`: negative hard gate that confirms unbalanced math
  delimiters are rejected
- `stepwise-derivation`: positive derivation case that keeps equivalent-transform
  steps explicit and records classroom/compact visual baselines
- `basic-probability-notation`: positive math-specific fixture that keeps
  standard `$P(A)=\frac{m}{n}$` notation explicit for text-grounded probability
  answers, then verifies validator/render/deliver behavior with classroom and
  compact visual baselines

## Output

The runner writes `results/latest.json` next to the dataset after each eval run.
