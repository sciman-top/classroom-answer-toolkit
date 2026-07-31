# VISION-020 Visual Page Normalization Evidence

## Goal and authority boundary

- Goal: establish a deterministic page coordinate authority before automatic region proposal.
- Canonical input: one public synthetic 720 x 540 captured page derived from the current VISION-007
  `junior-readable-measurement.source.png` bytes.
- Canonical result: detect the page quadrilateral, correct perspective/orientation, apply median
  denoise, and emit one hash-bound 560 x 360 `NormalizedPage` plus PNG.
- State preserved: human review required, `acceptanceDisposition=not_accepted`, controls=
  `not_verified`, `eligible=false`, and no `OptimizationCandidate`.
- `ReadinessControlReceipt` remains `unattested_local_record`; cloud egress remains disabled.
- This is a real local runtime over public synthetic bytes. It is not real-photo validation,
  automatic region detection, OCR/layout/semantic correctness, Track input integration, WPF
  workflow integration, gateway/workstation verification, or live acceptance.

## Canonical authority

| Artifact | SHA-256 |
| --- | --- |
| synthetic capture PNG | `bbfa0af726ec5660cf62853232c3ca885fa412fbeff3891756a76cf1d23cab7a` |
| normalization request | `dabb1d9b35cb4a8f339c22eab820bef525948e24b6900991f6711554dbc4a5db` |
| normalized PNG | `1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8` |
| normalization result | `4aad1b3baee1d75340bfb200857946128dce4c8acbeba4118a69ffd11653f47f` |

The capture is generated with fixed perspective coordinates and deterministic Gaussian noise. The
detector reports `(74,89) / (646,61) / (670,470) / (56,484)`, area ratio `0.607368`, and top-edge
orientation `-2.802452` degrees. The normalized page reports all four correction flags true and
retains `regionRefs=[]`.

## Fail-closed and atomic behavior

- Upstream VISION-007 source bytes, canonical capture bytes/pixels, request policy, dimensions, and
  local-only dispositions are rebound and revalidated.
- A missing page quadrilateral, noncanonical runtime request, existing output, lexical repository
  output, or physical parent resolving into repository authority is rejected.
- Runtime writes normalized PNG and result JSON into one external staging directory, re-reads both
  exact bytes, rechecks canonical request/capture snapshots, and only then atomically promotes the
  directory. Failed staging is removed.
- Focused test setup calls only `validate_fixtures()`. Explicit fixture materialization is a separate
  developer command, preventing test/assets parallelism from racing on canonical output.

## Focused verification

- Page normalizer: 8 passed, 0 failed, 1 platform skip.
- The skipped junction case requires Windows symlink privilege unavailable to the current token;
  lexical and physical containment remain covered by runtime checks and repository-output tests.
- Canonical replay: 4 artifacts validated byte-exactly.
- Asset validation: 165 assets, 3 subject packs, and 3 snapshots.
- Fresh visual inspection confirmed a nonblank skewed/noisy capture and a nonblank rectified
  560 x 360 output retaining the synthetic `12` measurement content. This is fixture-integrity
  inspection only, not real-image acceptance.

## Five-axis review

Review covered correctness, readability/simplicity, architecture, security, and performance:

1. Page normalization now precedes region proposal so future region coordinates have one stable
   rectified authority; VISION-007 explicit-bbox authority remains unchanged.
2. Focused test setup initially rematerialized canonical files, allowing parallel assets validation
   to observe a partial old/new result pair. Tests are now read-only and materialization is explicit.
3. Runtime initially relied on staging writes without re-reading them. It now rejects staged-byte
   tamper and rechecks canonical input snapshots before atomic promotion.
4. The result schema explicitly requires correction fields and component `name/version`; canonical
   schema and semantic replay both preserve synthetic-only, nonaccepted dispositions.
5. Processing is bounded to one 720 x 540 local image, performs no network/provider work, and adds
   no dependency beyond the existing OCR environment's OpenCV/Pillow packages.

No Critical or Required finding remains in the reviewed VISION-020 scope.

## Repository gate evidence

Final fixed-order verification ran from the Codex worktree on the reviewed implementation and
strategy tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors; 14.22 s |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 165 assets, 3 subject packs, 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; all hotspot gates passed; 1034.7 s |

Gate subprocesses used `%TEMP%\classroom-toolkit-dotnet-10.0.301` through temporary
`DOTNET_ROOT/PATH`. Bootstrap was not run and the system SDK was not modified. The hotspot used the
existing ignored OCR venv and renderer dependency junctions; they are not tracked changes.

Gateway template validation allowed missing example secrets, reported cloud egress disabled, and
made no live provider request. It is config/contract evidence only, not gateway verification.

## N/A and acceptance boundary

- `platform_na`: the external-junction regression is skipped because the current Windows token
  lacks symlink privilege. Alternative verification: lexical/physical path checks and repository
  output rejection. Recovery condition: rerun the same focused test under a privileged token before
  any trust expansion.
- `gate_na`: `answer-graphics` remains experimental and outside the default product gate. Recovery
  condition: an approved decision promotes it into the default delivery contract.
- `repo-side done`: yes after this atomic VISION-020 commit for the synthetic page-normalization
  schema/runtime/fixture/replay/visual inspection/hotspot scope only.
- `workflow integrated`: no. No Track or WPF default workflow consumes this output.
- `gateway verified`: no live provider/gateway request occurred.
- `workstation accepted`: no.
- `live accepted`: no.
- `still open`: automatic region proposal; multi-scale/local high-resolution crops; axis/table/tick/
  legend/component semantics; native `docx -> NormalizedPage`; legal real-photo benchmarks; real
  provider orchestration; source-question-to-`answer.md`; WPF review/writeback/persistence; live
  acceptance; optimization rollout; and renderer parity/migration.

## Rollback

Revert the VISION-020 commit and remove only its schemas, page-normalizer tool, canonical artifacts,
EOL rules, asset/hotspot wiring, strategy increments, and this evidence. Preserve VISION-007 through
VISION-019 authorities and commits `c291f9d`/`9c0d4f5`/`c09886b`, `.env`, ignored OCR/renderer
environments, gateway/review/readiness/WPF/flywheel authorities, and prior sample authorities.
