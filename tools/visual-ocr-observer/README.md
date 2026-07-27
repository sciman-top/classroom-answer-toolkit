# Visual OCR observer

This local-only runtime records RapidOCR observations from the three committed
VISION-007 scale=2 synthetic crops. It binds the same-case VISION-008 result as
sibling evidence but does not relabel structure candidates.

The output is diagnostic only. Empty observations and visibly incorrect text
are preserved; confidence is not correctness. Every result fixes ground truth
as unavailable, acceptance as not evaluated, human review as required,
semantics as not inferred, and Track integration as absent.

```powershell
npm --prefix tools/visual-ocr-observer test
npm --prefix tools/visual-ocr-observer run validate:fixtures
```

Runtime requests are admitted only by the committed inventory. The CLI cannot
select an alternate inventory or copied fixture authority, cannot write inside
the repository, and performs no network or cloud operation.
