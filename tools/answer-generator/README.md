# Synthetic Answer Generator

This tool implements the GEN-003 provider-neutral generation contract with
three deterministic local fixtures. It performs no network access and does not
invoke an AI model.

- requests live under `eval/answer-generation/cases/` and are schema-validated;
- delivery-chain fields are rejected by `additionalProperties=false`;
- every request binds the canonical synthetic problem raw bytes;
- every result is marked `provenance.providerKind=synthetic_fixture` and
  `liveProvider=false`;
- committed candidate Markdown and result JSON must reproduce byte-for-byte;
- generated descriptors bind request/result SHA-256 values and candidate raw
  bytes before sample-flywheel admission.

```powershell
npm --prefix tools/answer-generator test
npm --prefix tools/answer-generator run validate:fixtures
```

`materialize:fixtures` is a repository-maintenance command for regenerating the
three committed synthetic outputs. It is not a live generation entry point.
