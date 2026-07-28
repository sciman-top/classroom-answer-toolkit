# Visual machine review

This tool validates three current `ai_agent` visual review receipts for the
public VISION-007 synthetic scale=2 crops and deterministically compiles their
subject-isolated aggregate report.

The receipts are equivalent to a human visual check only under the explicit
`synthetic_fixture_diagnostic` policy. They retain `humanReviewed=false`, do
not populate `humanApproved`, and do not project delivery trust, WPF workflow,
readiness, real-data acceptance, or live acceptance.

```powershell
npm --prefix tools/visual-machine-review test
npm --prefix tools/visual-machine-review run validate:fixtures
```

Runtime output is report-only, must be outside the repository, and is promoted
only after all canonical preprocessing, crop, inventory, receipt, and report
snapshots are revalidated.
