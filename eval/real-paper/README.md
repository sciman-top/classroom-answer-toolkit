# Real-paper regression baselines

This directory records hash-bound, question-level outcomes for selected real exams without copying source exam content into Git.

## Commands

```powershell
npm --prefix eval/real-paper test
npm --prefix eval/real-paper run validate
```

`validate` requires the referenced local authority PDFs and delivery Markdown files to remain available at their repository-relative paths. It verifies raw-byte SHA-256 values, exact target-question coverage, independent blind/visual-audit/reference-review stages, and the teacher-acceptance boundary.

`not_run` is a first-class result. It must not be converted to pass or fail without a real stage artifact. A passing reference review never overwrites blind or visual-audit failures.

The checked-in metadata contains only paths, hashes, stage status, question-level result status, and evidence references. It does not copy exam pages or answer content.
