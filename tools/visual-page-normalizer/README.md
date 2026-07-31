# Visual Page Normalizer

Deterministic local runtime for one public synthetic captured-page fixture. It detects the page
quadrilateral from capture pixels, applies perspective/orientation correction and median denoise,
and emits a hash-bound `NormalizedPage` plus normalized PNG.

```powershell
npm --prefix tools/visual-page-normalizer run materialize:fixtures
npm --prefix tools/visual-page-normalizer test
npm --prefix tools/visual-page-normalizer run validate:fixtures
```

Materialization is an explicit developer action. Tests and validation are read-only against the
canonical fixture authority, so they can run alongside repository asset validation.

This proves synthetic normalization plumbing only. It does not prove quality on real photos,
detect question regions, run OCR, call a provider, or change review/trust/readiness state.
