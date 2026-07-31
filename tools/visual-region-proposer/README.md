# Visual Region Proposer

Deterministic local runtime that consumes the hash-bound VISION-020 normalized page and proposes
nonsemantic content-block bounding boxes. It also emits a diagnostic-only overlay.

```powershell
npm --prefix tools/visual-region-proposer run materialize:fixtures
npm --prefix tools/visual-region-proposer test
npm --prefix tools/visual-region-proposer run validate:fixtures
```

Materialization is explicit. Tests and validation are read-only against canonical authority.

The candidates are `heuristicOnly`; this tool does not generate `VisualRegion`, classify question,
figure, text, formula, table, axis, scale, or legend areas, run OCR, or change Track/review/trust/
readiness state.
