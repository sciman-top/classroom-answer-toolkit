# VISION-017 Synthetic OCR Layout Solver Evidence

## Goal and authority boundary

- Goal: consume the single public VISION-016 `measurement_reading` projection through a synthetic
  question/evidence bundle and deterministically emit one `ocr_layout_solver` TrackResult.
- Admitted case: `junior-readable-measurement / junior-physics-answer`.
- Candidate: `12 cm`. The numeric text `12` comes only from the VISION-016 projection bound to the
  OCR observation. Quantity `length` and unit `centimetre / cm` come only from the independent
  public synthetic question authority.
- Result scope: repo-side deterministic synthetic Track B plumbing. It is not general question
  parsing, quantity/unit understanding, scale reading, layout inference, FigureUnderstanding,
  Track C validation, Track A/B/C orchestration, provider output, or answer correctness on real
  questions.
- State preserved: `risk.level=high`, `reviewRequired=true`, `humanApproved=false`,
  `trusted=false`, `visualReviewPassed=null`, controls=`not_verified`, `eligible=false`, and
  `optimizationCandidateRefs=[]`.
- No `DecisionRecord`, delivery approval, review writeback, WPF workflow state, gateway live proof,
  workstation acceptance, or live acceptance is produced.
- `ReadinessControlReceipt` remains `unattested_local_record`; cloud egress remains disabled.

## Authority chain and canonical hashes

The runtime binds four canonical artifacts by repository-relative ref and raw-byte SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| synthetic question | `cce460567cdd14067f4c6b6ad58c43cc5f88e8d14af8518a707bed38076015ef` |
| ProblemEvidenceBundle | `9d29c3e2f54b9e2a39541be6baaa6d373458cd5b913d11a5bf558b33052ba5b6` |
| solver request | `1f6a53d356894c104c96b80faeace428da3c2c30d6eb2557e5615adbfc0ec3f1` |
| Track B result | `39771dc7d5efc1088b34d0f0b408fca15538139fb5d3798c19047c9119844589` |

The question contains no expected numeric answer. The request independently binds the question,
bundle, projection, interpretation, solver policy, and complete fail-closed dispositions. The
TrackResult records candidate provenance across those authorities and labels the result
`candidateSourceType=generated`; it is not a historical or teacher-approved sample.

## Fail-closed contracts

Compilation and runtime reject question/projection/bundle/request byte drift, stale embedded
hashes, subject/case/crop mismatches, absent explicit unit text, non-numeric OCR-bound text,
missing or non-`measurement_reading` projections, interpretation or review-disposition drift,
non-canonical request copies, pre-existing output, and repository-contained output paths.

Runtime output is staged and atomically promoted only to a new external path. The numeric grammar
is deliberately limited to the admitted ASCII-decimal form. OCR confidence, geometry, file name,
subject heuristics, expected-answer data, and delivery state cannot fill missing authority.

## Focused verification and regression repairs

- Solver focused suite: 11 passed, 0 failed, 0 skipped.
- Canonical validator: 4 artifacts replayed byte-exactly.
- VISION-016 projector regression: 22 passed, canonical fixture validation passed.
- Shared repository-output regressions: VISION-014 association 16/16, OCR diagnostics 18/18,
  text-region diagnostics 21/21, and machine review 19/19 passed in the hotspot.
- Asset validation: 160 files, 3 subject packs, and 3 snapshots.
- WPF/.NET contract tests: 121 passed, 0 failed, 0 skipped.

Five visual runtimes now reject lexically repository-contained output before resolving an external
path whose parent does not yet exist. This preserves the external-output contract on Windows while
still rejecting in-repository output. `.gitattributes` fixes LF authority for the affected visual
JSON/Markdown fixtures and Python runtimes; the pre-VISION-017 visual authority content has zero
Git diff after index normalization.

## Five-axis review

Review covered tests first, then correctness, readability, architecture, security, and
performance. Required findings already resolved in this slice:

1. Bundle-level question and projection hashes are revalidated at consumption time.
2. Expected interpretation and every fail-closed request disposition are revalidated rather than
   trusted as request metadata.
3. Runtime admission is fixed to the canonical request, refuses source/output aliases and existing
   outputs, and removes temporary staging on failure.
4. Repository-output checks were repaired at the shared visual runtime boundary and regression
   suites were rerun.
5. Windows LF authority is explicit, preventing checkout conversion from changing canonical
   raw-byte hashes.
6. An external junction could initially redirect a lexically external solver output into repository
   authority. A red-green regression now requires physical-parent resolution before atomic write.

No new third-party dependency was added. The implementation performs bounded reads over four
canonical artifacts and one projection, with no network, unbounded collection, or hot-path impact.

## Repository gate evidence

Final fixed-order verification ran from the Codex worktree on the reviewed tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 160 assets, 3 subject packs, 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; all hotspot gates passed |

The host system SDK lookup does not provide the exact pinned `10.0.301` toolchain. Gate subprocesses
used `%TEMP%\classroom-toolkit-dotnet-10.0.301` through temporary `DOTNET_ROOT` and `PATH` values.
Bootstrap was not run and the system SDK was not modified.

The Codex worktree initially lacked Git-ignored renderer dependencies, while the main checkout had
the exact same `tools/latex-renderer/package-lock.json` SHA-256 and a complete dependency tree. A
worktree-local junction to that `node_modules` restored the renderer smoke without changing tracked
files or dependency declarations. The standalone renderer smoke passed before the final hotspot.

Gateway validation used `.env.example` with missing example secrets allowed, reported cloud egress
disabled, and made no live request. It is configuration and synthetic request-contract evidence,
not gateway live verification.

## N/A and acceptance boundary

- `platform_na`: existing Windows symlink probes that require a token with symlink privilege may
  remain skipped. Alternative coverage is canonical containment, copied-root, hardlink/physical
  identity, path escape, TOCTOU, staged-tamper, and repository-output tests. Recovery condition:
  rerun on a Windows token with symlink capability before any trust expansion.
- `gate_na`: `answer-graphics` remains experimental and outside the default product gate. Recovery
  condition: add its approved smoke only if a future decision promotes it into the default delivery
  contract.
- `repo-side done`: pending this evidence commit, the synthetic question/bundle/request/Track B
  runtime, schemas, fixtures, validators, hotspot wiring, and strategy truth are implemented and
  verified.
- `workflow integrated`: no.
- `gateway verified`: no live provider or gateway verification occurred.
- `workstation accepted`: no.
- `live accepted`: no.
- `still open`: Track C validator; real Track A/B/C provider orchestration, conflict/degradation and
  evidence compiler runtime; production image/docx inputs; provider-to-`answer.md`; WPF review and
  trust lifecycle; legally sourced live benchmarks and acceptance; optimization admission; and
  renderer migration/parity.

## Rollback

Revert the single VISION-017 commit and remove only its solver schemas, tool, canonical
question/evidence/request/Track B artifacts, validator/hotspot wiring, strategy increments,
repository-output/EOL compatibility repair, and this evidence. Preserve all VISION-007 through
VISION-016 semantic authority, `.env`, local OCR and renderer environments, gateway settings,
delivery/review authorities, readiness receipts, flywheel authorities, and sample authorities.
