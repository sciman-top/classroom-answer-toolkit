# Visual Text-region Diagnostics Tool

This deterministic local compiler validates VISION-008 heuristic text-region
candidates against the VISION-011 generator-declared synthetic truth authority.
It reports spatial proposal coverage without recognizing text, selecting an OCR
association, inferring layout semantics, or producing Track evidence.

Run focused tests and canonical validation with:

```powershell
npm --prefix tools/visual-text-region-diagnostics test
npm --prefix tools/visual-text-region-diagnostics run validate:fixtures
```

The compiler never calls a model or network provider. Runtime report output is
allowed only in a new directory outside the repository.
