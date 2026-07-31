# Visual Local Cropper

Deterministic local runtime that turns admitted VISION-021 content-block proposals into 1x
pixel-preserving and 2x nearest-neighbor crops.

```powershell
npm --prefix tools/visual-local-cropper run materialize:fixtures
npm --prefix tools/visual-local-cropper test
npm --prefix tools/visual-local-cropper run validate:fixtures
```

Tests and validation are read-only. Crops remain proposal-bound and nonsemantic; this tool does not
generate `VisualRegion`, run OCR, classify content, or change Track/review/trust/readiness state.
