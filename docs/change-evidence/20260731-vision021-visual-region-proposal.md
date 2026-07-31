# VISION-021 Visual Region Proposal Evidence

## Goal and authority boundary

- Goal: automatically propose content-block regions after page normalization without assigning
  semantic `VisualRegion` types.
- Canonical inputs: VISION-020 normalization result and normalized PNG current raw bytes.
- Canonical result: two hash-bound `heuristicOnly` content-block candidates and one diagnostic-only
  overlay in `normalized_page_pixel` coordinates.
- State preserved: semantic not inferred, `VisualRegion` not generated, human review required,
  not accepted, controls=`not_verified`, `eligible=false`, and no `OptimizationCandidate`.
- `ReadinessControlReceipt` remains `unattested_local_record`; cloud egress remains disabled.
- This is a real local runtime over public synthetic bytes. It is not region quality validation,
  semantic classification, OCR/layout/Track integration, WPF workflow integration, gateway/
  workstation verification, or live acceptance.

## Canonical authority

| Artifact | SHA-256 |
| --- | --- |
| region proposal request | `a477bf762793e2b9dcaedb359c0fe0e0236533fe2dcbd15a1ecd36556b19b205` |
| diagnostic overlay PNG | `802f360026c6179bec89df3e57442f22ebdfa97cc33b3f172e86043880d41d2e` |
| region proposal result | `9597538175dd97686b1358de2515159c468cdafc62bf0ce71c49a8385bb319d4` |

The request binds VISION-020 result hash
`4aad1b3baee1d75340bfb200857946128dce4c8acbeba4118a69ffd11653f47f` and normalized PNG hash
`1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8`.

The runtime emits `(254,147,53,65)` and `(89,255,386,26)`. Visual inspection confirms the uniform
diagnostic boxes cover the visible `12` and the long line without touching the page border. This is
fixture-integrity inspection only; it does not label either candidate as text, reading, figure,
scale, or axis.

## Fail-closed and atomic behavior

- Upstream normalization result/PNG path, raw bytes, decoded pixels, page identity, dimensions,
  empty `regionRefs`, local-only dispositions, and request policy are rebound and revalidated.
- Empty pages, policy/hash drift, noncanonical requests, existing output, lexical repository output,
  or physical parents resolving into repository authority are rejected.
- More than 16 candidates fail closed rather than being silently truncated.
- Candidate objects have an exact nonsemantic field inventory; bbox area and foreground coverage are
  deterministically recomputed and byte-exact canonical replay catches drift.
- Runtime re-reads staged overlay/result bytes and upstream input snapshots before atomic promotion;
  failed staging is removed.
- Tests validate but never rematerialize canonical authority, so assets and focused suites can run
  concurrently without a canonical write race.

## Focused verification

- Region proposer: 9 passed, 0 failed, 1 platform skip.
- The skipped junction case requires Windows symlink privilege unavailable to the current token;
  lexical and physical containment remain covered by runtime checks and repository-output tests.
- Canonical replay: 3 artifacts validated byte-exactly.
- Asset validation: 167 assets, 3 subject packs, and 3 snapshots.
- `git diff --check`: passed.

## Five-axis review

1. Correctness: normalization precedes proposal, proposal ordering/bounds/areas/coverage are stable,
   and empty or excessive candidate inventories fail closed.
2. Readability/simplicity: one bounded local pipeline uses a frozen threshold, morphology, connected
   components, padding, ordering, and uniform overlay; no classifier abstraction is introduced.
3. Architecture: `RegionProposalCandidate` remains separate from semantic `VisualRegion`, and the
   existing VISION-007 explicit-bbox authority remains unchanged.
4. Security: current upstream bytes and physical containment are revalidated; staging and input
   snapshots are checked before atomic promotion; no network/provider access occurs.
5. Performance: work is bounded to one 560 x 360 image and at most 16 candidates, using existing
   OpenCV/Pillow dependencies.

No Critical or Required finding remains in the reviewed VISION-021 scope.

## Repository gate evidence

Final fixed-order verification ran from the Codex worktree on the reviewed implementation and
strategy tree:

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors; 12.68 s |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 167 assets, 3 subject packs, 3 snapshots |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; all hotspot gates passed; 945.7 s |

Gate subprocesses used `%TEMP%\classroom-toolkit-dotnet-10.0.301` through temporary
`DOTNET_ROOT/PATH`. Bootstrap was not run and the system SDK was not modified. The hotspot used the
existing ignored local environments; they are not tracked changes.

Gateway template validation allowed missing example secrets, reported cloud egress disabled, and
made no live provider request. It is config/contract evidence only, not gateway verification.

## N/A and acceptance boundary

- `platform_na`: external-junction regression skipped because the current Windows token lacks
  symlink privilege. Alternative verification: lexical/physical path checks and repository-output
  rejection. Recovery condition: rerun under a privileged token before any trust expansion.
- `gate_na`: `answer-graphics` remains experimental and outside the default product gate. Recovery
  condition: an approved decision promotes it into the default delivery contract.
- `repo-side done`: yes after this atomic VISION-021 commit for the public synthetic nonsemantic
  region-proposal schema/runtime/fixture/replay/overlay/hotspot scope only.
- `workflow integrated`: no. No OCR/Track/WPF default workflow consumes these candidates.
- `gateway verified`: no live provider/gateway request occurred.
- `workstation accepted`: no.
- `live accepted`: no.
- `still open`: multi-scale/local high-resolution crops; proposal classification and validated
  `VisualRegion`; axis/table/tick/legend/component semantics; native `docx -> NormalizedPage`;
  legal real-image benchmarks; real provider orchestration; source-question-to-`answer.md`; WPF
  review/writeback/persistence; live acceptance; optimization rollout; renderer parity/migration.

## Rollback

Revert the VISION-021 commit and remove only its schemas, region-proposer tool, canonical artifacts,
EOL rules, asset/hotspot wiring, strategy increments, and this evidence. Preserve VISION-007 through
VISION-020 authorities and commits `c291f9d`/`9c0d4f5`/`c09886b`/`26f1238`, `.env`, ignored local
environments, gateway/review/readiness/WPF/flywheel authorities, and prior sample authorities.
