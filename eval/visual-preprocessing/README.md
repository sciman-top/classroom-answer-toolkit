# Visual Preprocessing Eval

`cases/` contains exactly three public, sanitized `synthetic_fixture` bitmap
bundles for VISION-007:

- `math-function-graph`
- `junior-instrument-scale`
- `senior-circuit-label`

Each bundle has one source PNG, one provider-neutral request, deterministic 1x
and 2x crop PNGs, and one expected result. The inventory binds source, request,
and result raw bytes; each result additionally binds crop raw bytes and decoded
RGB pixels. These fixtures prove only local preprocessing contract behavior.
They do not represent real exam data, OCR/layout accuracy, Track A/B/C solving,
gateway integration, workflow integration, or live acceptance.
