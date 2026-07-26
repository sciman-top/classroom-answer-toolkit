# Delivery Aggregate Attachment

## Scope and truth boundary

- task: `REVIEW-005` (new repo-side capability recorded in the execution backlog)
- current landing point: a verified synthetic `DeliveryDecisionAggregate` can now be attached to its exact local delivery manifest preimage.
- target of this slice: preserve a fail-closed, replayable `aggregate -> receipt -> manifest` hash chain before any WPF positive-trust integration.
- write-set: delivery manifest/receipt schemas, canonical validation, visual-evidence attach/verify CLI, shared manifest lock and tests, .NET orchestrator/headless/diagnostics fail-closed projection and tests, asset contracts, strategy/eval/README, and this evidence.
- exclusions: no WPF command or positive aggregate projection, no lifecycle transition, no approval generation or write-back, no cloud request, no real exam paper, no live acceptance.

## Contract and behavior

- attachment first re-runs source-aware aggregate verification against the current manifest bytes; the aggregate binding must equal the manifest preimage SHA-256.
- the renderer delivery-manifest writer, `attach:decision` and `attach:aggregate` acquire an adjacent canonical-path lock plus a physical-identity lock under `%TEMP%/classroom-toolkit-delivery-manifest-locks/`; the latter is derived from `stat.dev/stat.ino` so hardlink aliases serialize on the same lock.
- each lock records PID, hostname, acquisition time, canonical manifest path, physical identity and random token. Existing locks are never auto-deleted; stale, malformed and remote-owner cases retain their original bytes and require audited manual recovery.
- manifest file symlinks, including dangling symlinks, are rejected before lock derivation. Existing hardlinks converge on the physical lock; partial acquisition and action failure release only owned-token locks.
- attachment snapshots manifest, aggregate, coverage, DecisionRecords, snapshot, input and inventory bytes, writes the verified preimage bytes to `<manifest>.before-delivery-decision-aggregate.json`, flushes temporary files before atomic rename, writes a receipt, rechecks the complete snapshot immediately before manifest replacement, then atomically replaces the manifest with aggregate refs and trusted projection.
- the manifest stores aggregate/preimage/backup/receipt references. The receipt stores `manifestResultSha256`; this avoids a self-referential manifest digest.
- verification rehydrates manifest, receipt, backup and aggregate, checks both hashes and references, then reruns aggregate verification against the backup preimage.
- existing attachment is idempotent only after that full verification succeeds; any mismatch is fail-closed.
- after manifest replacement the tool immediately reruns full verification; failure restores the preimage only when the manifest still equals this operation's result bytes.
- attachment never changes `review.lifecycle` and uses only local synthetic fixture copies in tests.
- the hash chain proves cross-file consistency, not resistance to a local attacker who can rewrite every artifact; no signing or append-only external evidence root is claimed.
- WPF orchestration, headless summary and diagnostics remain fail-closed for aggregate attachments until source-aware verification is integrated into those consumers; property presence, including `null/string/array`, clamps `visualReviewPassed=null / trusted=false`.

## Verification ledger

| Stage | Command or probe | Result |
| --- | --- | --- |
| attachment focused | `npm --prefix tools/visual-evidence run test:aggregate` | exit 0, 59/59, 0 skipped |
| visual-evidence all | `npm --prefix tools/visual-evidence run test` | exit 0, 70/70, 0 skipped |
| .NET consumer focused | filtered orchestrator/headless/diagnostics/runtime-contract tests | exit 0, 37/37 |
| asset contract focused | `npm --prefix tools/rule-compiler run validate:assets` | pre-lock-revision evidence: exit 0, 47 assets / 3 subject packs / 3 snapshots |
| asset contract final | `npm --prefix tools/rule-compiler run validate:assets` | exit 0, 47 assets / 3 subject packs / 3 snapshots |
| cross-subject focused | filtered `CrossSubjectContractTests` | exit 0, 16/16 |
| build | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0, 0 warnings / 0 errors |
| test | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0, 75/75 |
| cross-subject | `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0, snapshot `snapshot-fb15fdf69827ecf1` |
| hotspot | `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0, 211.7 seconds; decision 11/11, aggregate 59/59, gateway vision 6/6, renderer/eval/OCR passed |
| AI config | `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid, cloud egress disabled |
| lock cleanup | repo and `%TEMP%` physical lock scan after hotspot | 0 adjacent locks / 0 physical locks |
| independent review | five read-only review rounds | first four rejected and repaired; fifth accepted with no remaining actionable findings |

## N/A: live cloud gateway probes

- reason: this slice changes local schemas, manifest receipt/lock/hash verification, synthetic fixtures and fail-closed .NET status projection; it does not change gateway configuration, provider requests, failover or cloud egress.
- alternative_verification: local aggregate/attachment contract tests, canonical manifest validation, asset/cross-subject validation, and final local toolchain gate.
- evidence_link: `docs/change-evidence/20260726-delivery-aggregate-attachment.md`
- expires_at: `2026-08-26`
- recovery_condition: execute primary, fallback and forced-primary-failure synthetic-image probes before accepting a later gateway/provider or cloud-workflow change.

## Completion boundary and rollback

- `repo-side done`: yes for this bounded slice; implementation, independent review, fixed-order gates and evidence are closed in the projected commit.
- `gateway verified`: no new live provider verification in this slice.
- `workflow integrated`: false; WPF does not invoke or project aggregate attachment.
- `live accepted`: false.
- `still open`: WPF aggregate attachment/projection, real question-inventory generation, approval write-back, full review queue, Track B/C runtime and onsite acceptance.
- rollback: restore the manifest from its `.before-delivery-decision-aggregate.json` backup, remove the paired receipt, and revert this slice's schema/tool/test/doc changes. For an adjacent canonical lock or `%TEMP%/classroom-toolkit-delivery-manifest-locks/*.lock`, preserve the original lock bytes and inspect owner metadata; remove only after the recorded PID is confirmed dead and no renderer/attach writer is active. Malformed or remote-owner locks require explicit operator review. Runtime code never auto-deletes an unowned lock.
