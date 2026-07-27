# Visual Structure Extractor

This tool implements the VISION-008 provider-neutral structural primitive
contract. It consumes only committed VISION-007 2x synthetic crops and emits
deterministic pixel-level candidates:

- normalized Hough line segments;
- connected foreground regions;
- heuristic-only text-region candidates without recognized text.

Every result states `ocrDisposition=not_attempted`,
`semanticDisposition=not_inferred`, and `trackDisposition=not_integrated`.
The tool does not run OCR, infer axes/ticks/components, produce a
`FigureUnderstandingResult` or `TrackResult`, call a gateway, or access the
network. Runtime admission is fixed to the committed extraction inventory and
preprocessing authority; output must be a new directory outside the repository.

```powershell
npm --prefix tools/visual-structure-extractor test
npm --prefix tools/visual-structure-extractor run validate:fixtures
```

`materialize:fixtures` is a repository-maintenance command for the three
committed synthetic results. It is not a live-input entry point.
