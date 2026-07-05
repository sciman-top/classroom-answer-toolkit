# Acceptance Checklist

This checklist distills the most important runtime gates from the current v8.14 production spec.

## Hard gates

- Final deliverables keep only answer `.md` and answer `.pdf`.
- Classroom-display answer is the default output posture.
- Math must be rendered by a true LaTeX-capable path.
- Display formulas are left-aligned.
- Question number and first sub-question stay on the same first line.
- Multi-figure questions bind each sub-question to the correct figure or data source.
- Answers do not borrow evidence from a later figure to answer an earlier sub-question.
- Choice answers keep the compact `1—5：A、B、C、D、A` format with 5 answers per line.
- Non-choice answers must avoid drifting into lecture-note style long prose.
- Instrument-reading answers use the original figure reading as the direct answer source.
- Instrument-reading answers confirm figure binding before reading the instrument value.
- Instrument-reading answers re-check range and scale division before finalizing the value.
- Instrument-reading answers include an anchor chain: reading object, range or zero/start point, scale division, relative pointer/liquid/rider/endpoint position, and final value.
- Instrument-reading anchor chains cover electric meters, rulers, thermometers, spring scales, measuring cylinders, and balance riders when they appear.
- If an instrument-reading disagreement is at one scale-division level, re-open the original page image and re-read from neighboring major ticks in both directions.
- Calculations may cross-check an instrument-reading question but must not replace the original figure reading.
- Computation answers prefer stepwise fundamental formulas over compressed derived formulas.
- When multiple equivalent solution paths exist, prefer the more direct classroom-friendly path.
- Difficult sub-questions may retain necessary derivation instead of collapsing straight to the final result.
- Computation answers keep the full `公式-带单位代入-结果` closure.
- Delete formula hint lines that are not actually used in substitution.
- Prefer single-page compaction only when readability is preserved.
- No raw LaTeX markers appear in the final PDF.
- Render and source-review steps both succeed before transient cleanup.
- Experiment-design answers use score-point sentence patterns instead of casual explanation prose.

## Classroom readability

- Ordinary Chinese explanation lines should target about 20 characters.
- Hard upper bound is 24 Chinese characters for classroom-oriented profiles.
- Long explanations should be split by scoring points, not shrunk by font size.
- Formulas and inserted graphics must remain clear for back-row viewing.
- Short conclusions and numeric results should remain visually dense enough for fast classroom scanning.

## Current automated coverage

- choice-answer line format
- orphan question-number first lines
- backtick-wrapped math or units
- unbalanced dollar signs
- profile-based long-line warnings
- smoke validator/render/review chain
- minimal first-page visual regression for the smoke fixture

## Still manual or future automated coverage

- final PDF visual review
- formula overflow
- sparse/awkward pagination
- image insertion quality
- diagram-answer correctness
