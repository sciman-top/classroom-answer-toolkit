# DOCX page normalizer

This deterministic public synthetic adapter parses one narrowly admitted image-backed DOCX with
Python stdlib OPC/OOXML APIs and extracts its single internal PNG as one hash-bound `NormalizedPage`.
It rejects body text, tables, OMML, explicit pagination, multiple drawings, external relationships,
unsafe package entries, repository output, and positive trust state.

It does not reconstruct ordinary Word layout or support general DOCX documents. `python-docx` is
used only by the fixture-maintenance script with the bundled document runtime; it is not a runtime
dependency.

```powershell
npm --prefix tools/docx-page-normalizer test
npm --prefix tools/docx-page-normalizer run validate:fixtures
```
