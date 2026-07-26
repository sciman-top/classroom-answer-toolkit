# Sample Flywheel Evaluation

This evaluation surface contains fully synthetic, hash-bound fixtures for the
sample flywheel. It does not contain real exam papers or authorize cloud egress.

`cases/synthetic-readiness/readiness-case-inventory.json` is the hash-bound
expected-case authority. `readiness-input.json` must cover it exactly, so missing
runs or feedback remain in the recall denominator. The compiled report contains
three explicitly synthetic, deterministic `generated` candidates as a separate
bucket. It remains fail-closed because toolchain and restricted-egress controls
are `not_verified`; these fixtures are not real model output and cannot
authorize an `OptimizationCandidate`.
