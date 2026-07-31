# Track Orchestrator

Provider-neutral local orchestration for raw-byte-bound Track A/B/C results. The runtime admits
repository authorities, compares normalized Track A/B candidates, records conflict or missing-track
degradation, preserves Track C blocking findings, and delegates the final decision to
`tools/visual-evidence/decision-record.mjs`.

```powershell
npm --prefix tools/track-orchestrator test
npm --prefix tools/track-orchestrator run validate:fixtures
node tools/track-orchestrator/track-orchestrator.mjs compile `
  --request eval/track-orchestration/cases/junior-readable-measurement.track-orchestration-request.json `
  --out-dir $env:TEMP\classroom-track-orchestration
```

The canonical fixture is public and synthetic. Runtime output remains review-required, untrusted,
controls-not-verified, and ineligible; it is not provider, WPF, workstation, or live acceptance.
