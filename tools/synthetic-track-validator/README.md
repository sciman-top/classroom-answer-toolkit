# Synthetic Track C validator

This tool independently reloads the five public synthetic VISION-016/017 authorities and checks
question identity, quantity, unit, numeric/answer format, semantic provenance, and review state.
It emits a `ConsistencyReport` and a `rule_validator` TrackResult together.

Passing means only that seven limited deterministic checks agree on the canonical synthetic case.
The result remains review-required, untrusted, controls-not-verified, and ineligible. It does not
emit a `DecisionRecord`, approve an answer, or integrate Track orchestration, WPF, gateway, or live
acceptance.

```powershell
npm --prefix tools/synthetic-track-validator test
npm --prefix tools/synthetic-track-validator run validate:fixtures
node tools/synthetic-track-validator/synthetic-track-validator.mjs compile --request eval/synthetic-track-validator/cases/junior-readable-measurement.synthetic-track-validator-request.json --out-dir $env:TEMP/classroom-toolkit-track-c
```
