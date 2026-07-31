# Visual region semantics

This local deterministic compiler projects an explicit public synthetic declaration onto the
current VISION-021 proposal and VISION-022 1x/2x crop authorities. It performs no pixel, filename,
OCR, question, or answer inference.

The canonical fixture declares only two bounded roles: the visible reading block is `text_area /
measurement_reading`, and the long baseline is `scale_area / measurement_scale_baseline`. Both
remain review-required and unaccepted. The result does not establish question binding, generic
axis/table/tick/legend understanding, Track input, answer authority, delivery trust, WPF workflow,
gateway verification, workstation acceptance, or live acceptance.

```powershell
npm --prefix tools/visual-region-semantics test
npm --prefix tools/visual-region-semantics run validate:fixtures
pwsh tools/visual-region-semantics/run.ps1 `
  -Request eval/visual-region-semantics/cases/junior-readable-measurement.visual-region-semantics-request.json `
  -Out "$env:TEMP/classroom-toolkit-region-semantics"
```
