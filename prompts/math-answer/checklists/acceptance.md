# Acceptance Checklist

This checklist captures the current minimum runtime contract for the experimental `math-answer` subject pack.

## Hard gates

- Final deliverables keep only answer `.md` and answer `.pdf`.
- Classroom-display answer is the default output posture.
- Math must render through a true LaTeX-capable path.
- Display formulas stay left-aligned.
- Unbalanced dollar signs fail validation.
- Stepwise derivation may be kept when it improves classroom readability.
- Basic text-grounded statistics answers may state average/median/mode directly, with a short formula when it helps readability.
- Basic text-grounded probability answers may use standard `$P(A)=\frac{m}{n}$` notation.
- This pack stays an experimental cross-subject scaffold and must not be reported as a full junior-math production workflow.

## Current automated coverage

- linear-equation smoke
- stepwise derivation smoke
- basic statistics summary smoke
- basic probability notation smoke
- unbalanced-dollar hard gate
- cross-subject snapshot and asset validation
- shared markdown validator on math fixtures

## Still manual or future automated coverage

- final PDF visual review
- geometry and diagram-heavy items
- function-graph reading
- chart/data-driven statistics or probability conventions
