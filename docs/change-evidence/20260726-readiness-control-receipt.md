# FLYWHEEL-006 Readiness Control Receipt Evidence

## Scope

- current landing point: FLYWHEEL-005 computes honest bucket readiness but has
  no local record that binds the fixed repository gates to one clean revision.
- target landing point: produce and revalidate a hash-bound local
  `ReadinessControlReceipt` without granting it positive eligibility authority.
- rollback: revert the FLYWHEEL-006 implementation commit, the Windows npm
  invocation fix, and this evidence commit independently. Repository rollback
  does not delete or alter machine-local receipt directories.

## Changes

- added the `ReadinessControlReceipt` schema and a clean-HEAD runner for the
  fixed build, test, assets, cross-subject, toolchain, and gateway-config gates.
- bound ordered logs by SHA-256 and rejected reordered gates, impossible failed
  prefixes, source drift, path escape, symlink/hardlink aliases, and repository-
  owned output directories.
- forced `CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false` for controlled gate
  processes. This records process configuration only; it is not a network
  observation or restricted-egress attestation.
- kept readiness fail-closed: a receipt projects only
  `receiptStatus=unattested_local_record`; toolchain and restricted-egress
  remain `not_verified`, and `eligible=true` remains impossible.
- fixed Windows no-shell npm execution by running the bundled `npm-cli.js`
  through the current `node.exe`; no command string or caller-controlled gate
  argument is evaluated by a shell.

## Clean-HEAD Run

- source revision: `2734873de707757d85edc053ea4563cf5a13f913`.
- receipt:
  `C:\Users\sciman\AppData\Local\Temp\classroom-toolkit-readiness-control-5d7dd8315f0342deb7ba6e02ac46a641\readiness-control-receipt.json`.
- receipt SHA-256:
  `e969e5aeaf4d2941f59f7f615bab9a718fc10b18541e3b68a877593544e67088`.
- result: `passed`; six ordered gates returned exit code `0`; source was clean
  and revision-stable before and after the run.
- independent revalidation: the repository validator accepted the receipt
  against the current clean source and reported
  `readiness-control-63cf376c2488318c passed 6`.
- the receipt and logs remain outside the repository and are not committed.
  This evidence-only commit follows the bound implementation revision, so the
  receipt is historical local diagnostics, not continuing authority for later
  revisions.

## Failure And Recovery Evidence

- first run receipt SHA-256:
  `e4d9c01514462df32d21d621b714a44fdcf1ea62562178d85ae8534079896617`.
  It failed closed at build because the default system SDK set did not contain
  the `global.json`-pinned .NET SDK `10.0.301`.
- second run receipt SHA-256:
  `7f01dc1e1faa3c595a663c9417b920a2c5197ee35c1330e1935600c473c478bc`.
  After using the existing pinned SDK runtime, it failed closed at assets
  because Windows rejected `spawnSync("npm.cmd", ..., shell:false)` with
  `EINVAL`.
- recovery: reuse the previously verified temporary .NET `10.0.301` runtime,
  replace the Windows command shim with direct `node.exe + npm-cli.js`
  execution, add a real no-shell npm regression, rerun all gates, commit the
  fix, then run the clean-HEAD receipt in a new empty directory.

## Verification

Executed on 2026-07-26 in required order after the final implementation edit:

| Gate | Result |
| --- | --- |
| `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 114/114 passed |
| `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 53 files, 3 subject packs, 3 snapshots |
| `npm --prefix tools/rule-compiler run validate:cross-subject` | exit 0 |
| `powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 |
| sample-flywheel hotspot within toolchain | 49 passed, 0 failed, 1 platform skip |
| AI gateway vision contracts within toolchain | 6/6 synthetic contract tests passed |
| DecisionRecord contracts within toolchain | 11/11 passed |
| delivery aggregate contracts within toolchain | 59/59 passed |
| `npm --prefix tools/ai-gateway run validate:config` | exit 0; local config valid; cloud egress disabled |
| clean-HEAD receipt runner | exit 0; 6/6 gates; stable source revision |
| independent read-only reviews | both final verdicts: No blocker |

## N/A Records

### Live primary/fallback/forced-failure probes

- reason: cloud egress remained disabled; this slice validates local gate
  recording and does not authorize external transmission.
- alternative_verification: local gateway config validation and six synthetic
  request/failover contract tests passed.
- evidence_link:
  `docs/change-evidence/20260726-readiness-control-receipt.md`.
- expires_at: next explicitly authorized cloud-egress verification window.
- recovery_condition: explicitly enable cloud egress, use synthetic or
  de-identified images, and separately verify primary, fallback, and forced
  primary-failure automatic switching.

### Symlink containment capability

- reason: Windows returned `EPERM` for the capability-gated sample-run symlink
  fixture; no symlink was created or followed.
- alternative_verification: readiness junction-ancestor escape and hardlink
  alias tests passed; canonical containment remains enforced.
- evidence_link: `tools/sample-flywheel/readiness-control-receipt.test.mjs`.
- expires_at: next run on a host with symlink capability.
- recovery_condition: enable Windows Developer Mode/elevation or use non-Windows
  CI, rerun the sample-flywheel suite, and require no symlink skip.

## Residual Risks

- the local receipt is unsigned and unattested. A trusted CI signature,
  protected key, or equivalent provenance mechanism is still required before
  any receipt may remove an eligibility blocker.
- timeout handling terminates the immediate gate process; descendant-process
  cleanup is not proven for every tool and remains an operator inspection risk
  after a timeout.
- Windows assumes npm is bundled under the current Node installation; uncommon
  split Node/npm installations may fail closed and require a toolchain repair.

## Truth Boundary

- `repo-side done`: FLYWHEEL-006 schema, local runner, validation, fail-closed
  readiness projection, Windows no-shell repair, tests, strategy, and evidence.
- `gateway verified`: configuration and synthetic request/failover contracts
  only; no live provider request ran in this slice.
- `workflow integrated`: no; receipt generation and readiness remain outside
  the WPF main answer workflow.
- `live accepted`: no.
- `still open`: trusted signed/attested gate authority, observed restricted
  egress, truthful historical/generated samples, semantic grading, teacher
  free-text parsing, `OptimizationCandidate`, grey rollout, WPF integration,
  controlled real-sample acceptance, and live acceptance.
