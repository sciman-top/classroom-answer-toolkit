# Visual OCR Diagnostics Tool

This deterministic local compiler validates the canonical VISION-007 renderer,
preprocessing/source/crop authority, VISION-009 OCR observations, synthetic
text truth, inventory coverage, matching policy, and computed report bytes.

Run focused tests and canonical validation with:

```powershell
npm --prefix tools/visual-ocr-diagnostics test
npm --prefix tools/visual-ocr-diagnostics run validate:fixtures
```

The compiler never calls a model or network provider. Runtime report output is
allowed only in a new directory outside the repository.
