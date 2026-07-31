# VISION-022 Visual Local Crop Evidence

## Boundary and authority

- Input: VISION-021 result `9597538175dd97686b1358de2515159c468cdafc62bf0ce71c49a8385bb319d4`
  plus VISION-020 normalized PNG `1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8`.
- Request: `e458a00aedda862f7409aca8e283804be5e93e033a5feacc9b03e21e6916bf30`.
- Result: `162d96d1ca4e15282e16d159853459c4843475f972d9045b99d80706acac506d`.
- Crop hashes: `4dff334d...`/`74032b57...` for content-block-001 and
  `b7ed3fa9...`/`939b3a7b...` for content-block-002 at 1x/2x.
- 2x uses nearest interpolation and does not recover source detail or prove OCR quality.
- State remains nonsemantic, not integrated, review required, not accepted, controls not verified,
  `eligible=false`; receipt remains `unattested_local_record`; no live provider or optimizer.

## Review and focused verification

- 8 passed, 0 failed, 1 platform skip; canonical 6 artifacts replay byte-exactly.
- 169 assets, 3 subject packs, 3 snapshots; `git diff --check` passed.
- Invalid bboxes, request/source drift, noncanonical request, existing/repository output, staged
  tamper, and atomic five-output runtime fail closed. Junction coverage is platform-skipped without
  Windows symlink privilege.
- Five-axis review found no unresolved Critical/Required issue. Processing is bounded to two
  proposals/four crops, uses existing local dependencies, and has no network/provider call.

## Repository gates

| Order | Result |
| --- | --- |
| build | exit 0; 0 warnings/errors; 10.74s |
| xUnit | exit 0; 121 passed |
| assets | exit 0; 169 assets, 3 packs, 3 snapshots |
| hotspot | exit 0; all gates passed; 987.7s |

Gate subprocesses used temporary `%TEMP%\classroom-toolkit-dotnet-10.0.301` PATH/DOTNET_ROOT.
Bootstrap/system SDK were unchanged. Gateway validation was config-only with cloud egress disabled.

## Acceptance boundary

`repo-side done` is yes after this atomic commit for synthetic local crops only.
Workflow/gateway/workstation/live acceptance are no.
Still open: semantic `VisualRegion`, axis/table/tick/legend/component semantics, real-image region
benchmarks, OCR/Track/WPF integration, native docx input, answer.md provider chain, and live evidence.

Rollback reverts only the VISION-022 commit, preserving VISION-007 through VISION-021 and `4c302bb`.
