# DOCX Page Normalization Runtime Plan

## Boundary

VISION-026 admits exactly one public synthetic canonical DOCX under the
`image_backed_single_page_only` profile. The runtime parses OPC/OOXML package metadata and extracts
the document's single internal PNG byte-for-byte as one `NormalizedPage`.

This is not a Word layout engine. Ordinary paragraphs, additional empty paragraphs, tables, OMML,
explicit pagination, multiple drawings, external or linked images, and general multi-page DOCX
fidelity remain unsupported.

## Package Contract

1. The package is limited to 128 entries and 10 MiB total declared uncompressed bytes.
2. Encrypted, duplicate, directory, absolute, parent-traversing, backslash, and noncanonical entry
   names are rejected before parts are read.
3. `[Content_Types].xml`, `word/document.xml`, and `word/_rels/document.xml.rels` must have the exact
   OPC/WordprocessingML roots.
4. The body must contain one image paragraph and one section declaration, with no text, table, OMML,
   explicit page break, extra drawing, blip, or inline object.
5. Relationship ids must be unique. Exactly one internal image relationship may exist; `r:link`,
   `TargetMode`, noncanonical target paths, and a content type other than `image/png` are rejected.
6. The embedded PNG raw bytes, decoded RGB pixels, size, package facts, request bytes, and source DOCX
   bytes are hash-bound to the canonical authority.

## Runtime And Output

The runtime accepts only the canonical request identity. It snapshots request/source bytes, writes a
result and `page-001.png` into a new staging directory outside repository authority, rereads staged
bytes and inputs, then atomically promotes the directory. Existing output, repository output,
physical parent aliases into the repository, staged tamper, or input drift fail closed.

The `NormalizedPage` records `sourceKind=docx`, page 1, 560x360 pixels, 96 DPI, no preprocessing, and
empty region/OCR/layout/quality references. The result fixes layout/body/table/OMML/Track/answer and
acceptance dispositions to unsupported, not reconstructed, not integrated, not generated, or not
accepted as appropriate, and always requires human review.

## Verification

- Focused Python tests cover canonical compilation, package/body/relationship/content-type rejection,
  hash and trust escalation, output containment, atomic staging, input snapshots, and byte-exact replay.
- `validate:assets` validates both schemas and the fixed fail-closed result boundary.
- `check-toolchain.ps1` runs focused tests and canonical fixture validation.
- The canonical DOCX is rendered and visually inspected as one complete unclipped page; the adapter's
  external runtime output is independently hash-compared and its exact temporary directory removed.

## Truth Boundary

This slice is public synthetic and repo-side only. It is not connected to the WPF default workflow or
AI gateway and does not prove general DOCX fidelity, real-paper handling, OCR/layout/Track correctness,
workstation acceptance, or live acceptance. `ReadinessControlReceipt=unattested_local_record`, controls
remain `not_verified`, `eligible=false`, and no `OptimizationCandidate` is generated.

## Rollback

Rollback the VISION-026 atomic commit, removing only its schemas, tool, fixtures, asset/hotspot wiring,
strategy increments, and evidence. Preserve VISION-007 through VISION-025 authorities, `.env`, local
runtimes, gateway, delivery/review, readiness, flywheel, and samples.
