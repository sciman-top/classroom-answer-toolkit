# Visual OCR-region association

This tool applies a deterministic, bidirectionally unique positive-area
association policy to the canonical VISION-008/009/010 synthetic authorities.
It does not copy OCR text or infer OCR correctness, layout, subject semantics,
FigureUnderstanding, Track B, delivery trust, WPF state, or live acceptance.

The current canonical fixtures honestly produce two `unavailable` cases and
one `unmatched` case. Positive and ambiguous geometry are policy-unit tests,
not canonical or acceptance samples.

```powershell
npm --prefix tools/visual-ocr-region-association test
npm --prefix tools/visual-ocr-region-association run validate:fixtures
```

Runtime output is report-only, must be outside the repository, and is promoted
only after all upstream and canonical snapshots are revalidated.
