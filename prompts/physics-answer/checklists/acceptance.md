# Acceptance Checklist

This checklist distills the most important runtime gates from the current v8.6 production spec.

## Hard gates

- Final deliverables keep only answer `.md` and answer `.pdf`.
- Math must be rendered by a true LaTeX-capable path.
- Display formulas are left-aligned.
- Question number and first sub-question stay on the same first line.
- Choice answers use the format `1—5：A、B、C、D、A`.
- No raw LaTeX markers appear in the final PDF.
- Render and source-review steps both succeed before transient cleanup.

## Classroom readability

- Ordinary Chinese explanation lines should target about 20 characters.
- Hard upper bound is 24 Chinese characters for classroom-oriented profiles.
- Long explanations should be split by scoring points, not shrunk by font size.
- Formulas and inserted graphics must remain clear for back-row viewing.

## Current automated coverage

- choice-answer line format
- orphan question-number first lines
- backtick-wrapped math or units
- unbalanced dollar signs
- profile-based long-line warnings

## Still manual or future automated coverage

- final PDF visual review
- formula overflow
- sparse/awkward pagination
- image insertion quality
- diagram-answer correctness
