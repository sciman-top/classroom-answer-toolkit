# Release and Transfer

## Scope

This repository distributes three intentionally separate artifacts:

| Artifact | Audience | Includes | Must not include |
| --- | --- | --- | --- |
| Developer/operator online preview | repository maintainers familiar with the local toolchain | independently verified published WPF application and matching public workspace | real `.env`, private papers, delivery outputs, `.git` |
| `ClassroomToolkit-<version>-source.zip` | public developers | source, tests, scripts, prompt assets, lock files, `.env.example` | real `.env`, `node_modules`, local cache and delivery data |
| PrivateDev transfer ZIP | the private maintainer only | current working-tree snapshot and, only when explicitly requested, `.env` / `.git` / app | GitHub Release publication or any shared distribution channel |

The online preview remains a repository-coupled companion. Its
initial installer fetches the matching public source workspace as a separate,
verified Release asset and initializes the supported toolchain. This does not
embed source inside the app ZIP, and it is not a claim of an offline,
self-contained MSIX product.

## Public Release

本机生成的候选文件统一放在 Git 忽略的 `artifacts/deliveries/<version>/`；历史证据和归档放在 `artifacts/history/<kind>/<date-or-id>/`，可重建中间物放在 `artifacts/work/<kind>/`，禁止跨层混放。清理旧版本及临时目录使用 `scripts/clean-artifacts.ps1 -KeepVersion <version>`。GitHub Release 才是公开下载入口，仓库不提交 ZIP、EXE、诊断输出或 SBOM 工具缓存。

Create an annotated tag named `v<major>.<minor>.<patch>` and push that tag.
The GitHub Actions workflow performs the local setup and integration gates,
creates the app and source ZIPs, writes `update-manifest.json`, generates an
SPDX SBOM and provenance attestations, and publishes those assets plus
`scripts/install-release.ps1` to the GitHub Release.

The existing `v1.0.1` Release is a previously published tag snapshot. The
post-release hardening currently on `main` is not represented by that Release
until a new versioned tag runs this workflow. Do not replace an existing
Release asset manually with a locally generated ZIP; the manifest, SBOM and
attestation must be produced by the same clean tagged source.

The manifest binds each asset to a URL, byte count and SHA-256, plus a
`workspaceContract`. The WPF app only accepts a newer semantic version, a
matching installed workspace contract, and an app asset hosted on GitHub HTTPS.
The updater verifies the downloaded ZIP before it extracts it, waits for the
main process to exit, moves the old app directory to a timestamped backup,
requires a successful replacement smoke before normal restart, and restores
the backup if replacement or smoke fails. When a release raises
`workspaceContract`, it must be installed with
the preview installer into a new empty destination; the updater will not
silently replace a workspace, `.env`, or user files.

## Automated Simulation Acceptance

Repeatable operator work can be exercised without a second machine or a
GitHub write by running:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/simulate-release-acceptance.ps1 -Version 1.0.1
```

The simulation serves the already verified candidate assets from a temporary
loopback HTTP server and drives the real installer, updater and transfer
scripts. It covers empty and occupied destinations, a successful update and
smoke restart, replacement failure with rollback, and PrivateDev import with
existing `.env` preservation. The receipt is written under
`artifacts/work/verification/release-simulation/` and is intentionally
cleaned with the other generated work artifacts.

`-AllowLocalSimulation` and `-Simulation` are explicit test-only seams. The
normal installer and updater continue to accept only approved GitHub HTTPS
hosts; loopback is never an implicit production fallback. A passed receipt is
`simulated-acceptance` evidence for deterministic operational contracts. It
does not establish publisher identity, GitHub publication, UAC/antivirus or
ordinary-user experience, live provider quality, or teacher/classroom
acceptance.

An ordinary-user standard edition and an offline full edition are intentionally
not published. `package-release.ps1 -Audience ordinary-users` fails closed
unless the application has a valid Authenticode signature. Productization
remains blocked until a versioned runtime bundle includes the required
Node/runtime dependencies and assets, has a signed
installation/update/rollback contract, and passes representative non-developer
installation and acceptance checks.

No code-signing certificate is configured by this repository. SHA-256 is an
integrity check for the published Release asset; it is not a substitute for a
publisher identity signature. Before distributing to non-developer users,
configure Authenticode signing in a protected CI secret; the existing
ordinary-user packaging gate will then verify the signature before packaging.

## Source Development

Use Git when contribution history and normal merge behavior matter:

```powershell
git clone https://github.com/sciman-top/classroom-answer-toolkit.git
Set-Location classroom-answer-toolkit
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/setup-development.ps1
```

For a source ZIP, extract it and run the same setup command. The setup creates
`.env` from `.env.example` only when no `.env` exists, so a configured local
provider file is preserved on repeat runs. It never prints secret values.

## Private Migration

`export-transfer.ps1` has two modes:

```powershell
# Public, committed source only. Rejects .env and .git.
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/export-transfer.ps1 `
  -Mode PublicSource -Output "D:\Transfer\ClassroomToolkit-source.zip"

# Current private working tree. Include secrets only with this explicit switch.
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/export-transfer.ps1 `
  -Mode PrivateDev -IncludeEnv -Output "D:\Transfer\ClassroomToolkit-private.zip"
```

Every transfer ZIP carries `transfer-manifest.json`, which records file paths,
byte counts and SHA-256 hashes without recording secret values. The importer
rejects archive traversal, undeclared files and integrity drift. It moves an
existing target to a timestamped backup before placing the new package; if
import or setup fails, it preserves the failed candidate alongside the
destination and restores that backup.

Private packages can contain plain-text API keys. Store and transfer them only
through an encrypted, maintainer-controlled channel. Rotate any provider key
that is exposed to a shared drive, repository, chat, issue tracker, or Release.

## Rollback

The app updater retains the previous `app` directory alongside the active one
with a timestamped `.backup.<utc>` suffix. A failed replacement restores the
backup automatically. Transfer import uses the same move-first backup model
for an existing target. These automatic backups do not replace a source-control
commit or a separate backup of user papers and completed deliveries.
