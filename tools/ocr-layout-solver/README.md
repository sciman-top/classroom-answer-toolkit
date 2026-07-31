# Synthetic OCR layout solver

This tool binds one public synthetic question and one VISION-016 semantic projection into a
deterministic `ocr_layout_solver` `TrackResult`. The numeric value comes from bound OCR text; the
quantity and unit come from the explicit question authority.

The result is diagnostic-only and always requires review. It does not emit a `DecisionRecord`,
grant trust, verify controls, enable cloud egress, or prove real-data solver quality.

```powershell
npm --prefix tools/ocr-layout-solver test
npm --prefix tools/ocr-layout-solver run validate:fixtures
node tools/ocr-layout-solver/ocr-layout-solver.mjs compile --request eval/ocr-layout-solver/cases/junior-readable-measurement.ocr-layout-solver-request.json --out $env:TEMP/classroom-toolkit-track-b.json
```
