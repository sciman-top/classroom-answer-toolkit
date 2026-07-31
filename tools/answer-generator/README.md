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

`provider-generator.mjs` is the separate GEN-004 model-provider runtime. It requires public data,
hash-bound subject-pack instructions, request-level `egressPolicy.allowCloud=true`, the runtime
`--allow-cloud-egress` flag, and gateway-level cloud egress. It writes `answer.md` and a fail-closed
result to a new external directory. Output remains `pending_review`, `trusted=false`, and
`workflowDisposition=not_integrated`.

```powershell
npm --prefix tools/answer-generator run generate:provider -- --request <request.json> --workspace-root <root> --out <new-directory> --allow-cloud-egress
```

This command can cause real network egress. Tests mock Responses and Chat Completions and do not
establish live gateway acceptance.
