# Sample Flywheel Evaluation

This evaluation surface contains fully synthetic, hash-bound fixtures for the
sample flywheel. It does not contain real exam papers or authorize cloud egress.

`cases/synthetic-readiness/readiness-case-inventory.json` is the hash-bound
expected-case authority. `readiness-input.json` must cover it exactly, so missing
runs or feedback remain in the recall denominator. The compiled report is
intentionally fail-closed while no truthful `historical_candidate` or `generated`
bucket has enough samples and no verifiable gate or egress receipts exist.
