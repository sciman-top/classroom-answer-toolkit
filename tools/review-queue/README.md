# Review Queue Projector

This local-only tool projects explicitly selected review artifacts into three
read-only queues:

- `needs_human_label`
- `high_risk_approval`
- `truth_needs_review`

It accepts only `FeedbackParseResult`, `DecisionRecord`, and
`DeliveryDecisionAggregate` JSON. Each source is canonicalized, hashed from raw
bytes, and source-reverified through the existing compiler authority. One
rejected source makes the complete result fail closed with no projected items.

```powershell
npm --prefix tools/review-queue run project -- `
  --artifact <feedback-parse-result.json> `
  --artifact <decision-record.json>
```

The result authority is `local_verified_projection`. The tool does not write
source artifacts, generate approvals, advance lifecycle, modify trust, create
an `OptimizationCandidate`, or use cloud egress.
