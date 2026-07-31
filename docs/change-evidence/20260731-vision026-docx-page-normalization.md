# VISION-026 DOCX Page Normalization Evidence

Date: 2026-07-31

## Scope

VISION-026 adds a deterministic public synthetic `image_backed_single_page_only` adapter. It parses
one canonical DOCX with Python stdlib OPC/OOXML APIs, extracts its single internal PNG byte-for-byte,
and emits one hash-bound `NormalizedPage`. It does not reconstruct ordinary Word layout.

## Authority Hashes

| artifact | SHA-256 |
| --- | --- |
| canonical DOCX | `910a46a2e1dcc4cd0934df78670790b5af2a232031909367fbe962d5955fa519` |
| normalization request | `bc0af57228877417082d59e84e651b94d9b0e780096b44b264a3e7f78c5f7347` |
| normalization result | `c32c609e51c8bb988ae047ac818a0b77c46c153754f57e25829788d8acd41a5c` |
| embedded/output PNG raw bytes | `1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8` |
| embedded/output PNG decoded RGB pixels | `4cfa63971d77ae3c8777784f72c6f5fec995e12871d5dc48674c2db2689100bd` |

Canonical package inspection records 18 entries, 957012 uncompressed bytes, relationship `rId9`,
part `word/media/image1.png`, extent 5943600 x 3820886 EMU, and a 560 x 360 image at 96 DPI.

## Test-First And Review Evidence

The first focused run after parser hardening failed two assertions because the new body-shape fallback
ran before the existing body-text and drawing-specific checks. The inputs still failed closed. The
root fix moved only the structural fallback after the more specific checks; the next run passed.

Five-axis review:

1. Functional: the canonical internal PNG is emitted byte-for-byte as exactly one `NormalizedPage`.
2. Contract: request/result schemas, exact replay, asset validation, and hotspot wiring reject positive
   state or canonical authority drift; `.gitattributes` fixes canonical fixture JSON and runtime Python
   files to LF across Windows checkouts.
3. Security: package count/size/name limits, unique relationship ids, one internal PNG relationship,
   `image/png` content type, canonical request admission, repository containment, staged-byte reread,
   input snapshots, and atomic promotion are enforced.
4. Compatibility: all VISION-007 through VISION-025 authorities remain unchanged. The adapter is
   additive and is not connected to the default WPF or gateway workflow.
5. Truth: this is a public synthetic single-image extraction adapter, not a Word layout engine,
   real-document fidelity proof, OCR/layout/Track result, answer, trust, or live evidence.

## Focused Verification

| verification | result |
| --- | --- |
| `npm --prefix tools/docx-page-normalizer test` | exit 0; 9 tests: 8 passed; 1 Windows symlink privilege skip |
| `npm --prefix tools/docx-page-normalizer run validate:fixtures` | exit 0; 1 canonical fixture |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots |
| external runtime invocation | exit 0; result SHA-256 `c32c609e...1a5c`; page SHA-256 `1ae505c9...dd8`; exact probe directory removed and verified absent |
| DOCX render and visual inspection | LibreOffice exit 0; one Letter page; 1224 x 1584 at 144 DPI; complete centered image; no clipping, overlap, or missing glyphs; exact render directory removed and verified absent |

The suite covers source/hash and positive-state drift, body text/shape, multiple drawings, external or
linked images, duplicate/extra image relationships, content-type drift, canonical identity, repository
containment, staged tamper, input-snapshot drift, and byte-exact replay.

`platform_na`: `reason=current Windows token lacks directory-symlink privilege (WinError 1314)`;
`alternative_verification=resolved physical parent containment plus direct repository-output rejection`;
`evidence_link=this focused test output`; `expires_at=next privileged Windows verification`;
`recovery_condition=current token can create a directory symlink`.

`platform_na`: `reason=bundled render_docx.py emits a Windows-incompatible LibreOffice profile URI
and bundled pdftoppm.cmd points to a missing executable`;
`alternative_verification=manual soffice.com with a file:///C:/... profile URI plus the bundled real
Poppler executable rendered one PNG that was inspected at original resolution`;
`evidence_link=this render result`; `expires_at=next managed document runtime refresh`;
`recovery_condition=managed renderer and wrapper successfully render this fixture on Windows`.

## Fixed Gates

The complete candidate implementation and strategy tree passed the required order with the temporary
pinned SDK projected only inside the build/test subprocesses:

| order | command | result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; SDK 10.0.301; 0 warnings; 0 errors; 22.8 s |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 121 passed; 0 failed; 0 skipped; 14.8 s |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 180 assets; 3 subject packs; 3 snapshots; 3.7 s |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0; 1107.8 s; toolchain complete |

No bootstrap or system SDK modification is permitted.

## Acceptance Boundary

- `repo-side done`: implementation and fixed gates are complete on the VISION-026 branch candidate;
  the atomic commit containing this record is the repository evidence boundary and is not on `main`.
- `workflow integrated`: no.
- `gateway verified`: no new evidence.
- `workstation accepted`: no.
- `live accepted`: no.
- readiness: `ReadinessControlReceipt=unattested_local_record`, controls=`not_verified`,
  `eligible=false`; no `OptimizationCandidate` is generated.

## Rollback

Rollback the VISION-026 atomic commit. Remove only its schemas, adapter/tests, canonical fixtures,
asset/hotspot wiring, strategy updates, and this evidence file. Preserve VISION-007 through
VISION-025 authorities, `.env`, local runtimes, gateway, delivery/review, readiness, flywheel, and
canonical samples.
