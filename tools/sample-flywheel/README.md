# Sample Flywheel

This tool provides the first executable, fully synthetic sample-run admission and recording slice.

- `样例交付/index.json` is the non-overridable canonical authority and binds each package by subject, path, and SHA-256.
- `candidateBindings` bind each admitted negative-candidate descriptor by path and SHA-256; records carry that descriptor hash.
- `.gitattributes` fixes hash-bound sample JSON/Markdown assets to LF across checkouts.
- package and artifact references must remain under their canonical roots after realpath resolution.
- `plumbing` requires explicit truth/leakage states and emits no diff or optimization signal.
- `scoring` enforces indexed candidate, truth-extraction, and leakage gates.
- records pass the repository's limited shape validator, compiler semantic invariants, and verification against current canonical authority bytes.
- the current comparator is SHA-256 exact-diff only; root cause comes from the synthetic negative-candidate label.
- no semantic answer grading, `OptimizationCandidate`, cloud egress, or live acceptance is implemented.
- arbitrary archived-authority verification is not implemented.
