# Math Answer Eval

This dataset exercises the shared markdown validator and delivery pipeline for
the `math-answer` subject pack.

## Coverage

- `linear-equation-smoke`: positive smoke case with classroom and compact
  visual baselines
- `unbalanced-dollar`: negative hard gate that confirms unbalanced math
  delimiters are rejected

## Output

The runner writes `results/latest.json` next to the dataset after each eval run.
