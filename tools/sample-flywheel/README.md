# Sample Flywheel

This tool provides the first executable, fully synthetic sample-run admission and recording slice.

- `样例交付/index.json` is the non-overridable canonical authority and binds each package by subject, path, and SHA-256.
- `candidateBindings` bind each admitted negative-candidate descriptor by path and SHA-256; records carry that descriptor hash.
- generated descriptors additionally bind the provider-neutral generation request, deterministic result, and raw candidate bytes; any provenance or hash drift fails closed.
- `.gitattributes` fixes hash-bound sample JSON/Markdown assets to LF across checkouts.
- package and artifact references must remain under their canonical roots after realpath resolution.
- `plumbing` requires explicit truth/leakage states and emits no diff or optimization signal.
- `scoring` enforces indexed candidate, truth-extraction, and leakage gates.
- records pass the repository's limited shape validator, compiler semantic invariants, and verification against current canonical authority bytes.
- the current comparator is SHA-256 exact-diff only; root cause comes from the synthetic negative-candidate label.
- current-authority-valid, non-exact fixture scoring runs can compile one source-byte-bound `FeedbackParseResult`.
- feedback attribution uses hash-bound fixture severity/confidence and always emits no optimization candidate.
- bounded teacher-text parsing accepts hash-inventory-admitted, repository-owned public `synthetic_fixture` submissions only; one explicit non-negated error type and one explicit severity produce `source=teacher_input`, while missing, ambiguous, or explicitly negated signals fail closed to `needs_human_label` with no feedback record. Negation handling is a finite prefix lexicon, not general linguistic interpretation.
- teacher-text results are diagnostic fixtures and are not admitted into readiness recall or optimization eligibility.
- the canonical `TeacherFeedbackDiagnosticReport` independently reports fixture ingestion structure/human-label rates and complete error/severity/reason distributions; it does not contribute candidate readiness or eligibility.
- a hash-bound canonical case inventory plus a complete runtime manifest can compile a per-source `OptimizationReadinessReport`; missing runs or feedback remain in the recall denominator and unmet gates fail closed.
- without a receipt, toolchain and restricted-egress controls remain `not_verified`.
- `run:control-gates` executes the fixed gate sequence from a clean HEAD, forces cloud egress disabled, writes logs and a hash-bound receipt outside the repository, and rechecks the clean revision after execution.
- readiness can reverify receipt bytes, ordered logs, and current clean revision,
  but treats the unsigned result as `unattested_local_record`; controls remain
  `not_verified` and cannot authorize eligibility.
- the committed synthetic readiness fixture reports `generated n=3` independently, but controls remain `not_verified`, eligibility remains false, and optimization refs remain empty.
- no semantic answer grading, `OptimizationCandidate`, WPF generation workflow, cloud egress, or live acceptance is implemented.
- open-domain teacher free-text interpretation and real teacher-data admission are not implemented.
- arbitrary archived-authority verification is not implemented.

Compile the committed synthetic readiness fixture:

```powershell
npm --prefix tools/sample-flywheel run compile:readiness -- `
  --manifest eval/sample-flywheel/cases/synthetic-readiness/readiness-input.json `
  --out eval/sample-flywheel/cases/synthetic-readiness/readiness-report.json
```

Compile the canonical synthetic teacher-feedback diagnostic report to a
path outside the repository (repository-owned canonical assets are never valid
CLI output targets):

```powershell
npm --prefix tools/sample-flywheel run compile:teacher-diagnostics -- `
  --out "$env:TEMP/classroom-teacher-feedback-diagnostic-report.json"
```

Run the controlled gates from a clean checkout. The output directory must be
empty and outside the repository:

```powershell
$env:DOTNET_ROOT = Join-Path $env:TEMP 'classroom-toolkit-dotnet-10.0.301'
$env:PATH = "$env:DOTNET_ROOT;$env:PATH"
npm --prefix tools/sample-flywheel run run:control-gates -- `
  --out-dir "$env:TEMP/classroom-toolkit-readiness-control"
```

The receipt records consistency of one local controlled run. Its logs and
booleans are not provenance-bearing and can be recreated by a local writer, so
it is not positive gate authority. It does not observe general network traffic,
run live probes, or establish live gateway or workflow acceptance.
