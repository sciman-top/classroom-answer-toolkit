# Agent Rule Governance 9.57

## Scope and boundary

- repository: `classroom-answer-toolkit`
- frozen baseline: `6486358e7ff5081a59b3d6168967ab0d9169a2fd`
- task branch: `codex/agent-rule-governance-9.57`
- write-set: `AGENTS.md` and this evidence file; `CLAUDE.md` remains the verified import-only wrapper
- release review: `rule_release=9.57 / project_contract_version=2.0 / coordination_schema=2.3`
- semantic basis: Claude Code's current official memory documentation permits imports up to five hops; the project WHERE/HOW contract itself is unchanged
- exclusions: no product/runtime/schema/data/dependency/auth/provider/secret/MCP/account/process/hosted-UI change

## Verification ledger

- wrapper: `CLAUDE.md` verified as the import-only `@AGENTS.md` wrapper, no BOM; control-repo `--require-all` target audit passed for all 9 isolated targets
- build/test: `dotnet test --no-restore --nologo` passed, 57/57 tests
- contract/invariant: 43 rule assets, 3 subject packs, 3 snapshots, six vision-contract tests, three visual-decision tests, and cross-subject validation passed
- hotspot/full: `scripts/check-toolchain.ps1` passed in 189.8 seconds, including local headless PDF render/review and all answer eval fixtures; this was repository-local rendering, not hosted Chat UI probing
- diff hygiene: `git diff --check` passed
- five-axis review: correctness/readability/architecture/security/performance passed with no Critical or Required finding
- supply-chain observation: isolated `npm ci` reported 1 moderate and 1 high advisory in the existing lock; no dependency was changed in this governance slice, so remediation remains a separate owner-reviewed task
- Git publication: not yet executed at this capture point

## Compatibility and rollback

- compatibility: content-release review marker only; repository commands, invariants, external behavior, data formats, and wrapper loading shape remain unchanged
- rollback: revert only `AGENTS.md` and this evidence file from the task commit; do not reset, clean, or include unrelated local history

## Completion boundary at capture

- `repo-side completed=true`
- `published branch=false`
- `default-branch effective=false`
- `hosted/manual accepted=false`
- `fully completed=false`
