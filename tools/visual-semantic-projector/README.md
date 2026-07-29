# Visual semantic projector

This tool projects one explicitly declared `measurement_reading` role through
the exact VISION-011/012/014 evidence triangle. Recognized text is copied only
from the bound OCR observation. Runtime output is report-only, atomic, and
restricted to a new directory outside the repository.

It does not infer layout, create `FigureUnderstandingResult`,
`ProblemEvidenceBundle`, `TrackResult`, an answer candidate, delivery trust,
WPF state, eligibility, or live acceptance.

```powershell
npm --prefix tools/visual-semantic-projector test
npm --prefix tools/visual-semantic-projector run validate:fixtures
```
