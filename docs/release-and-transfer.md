# Release and Transfer

## Scope

This repository defines four intentionally separate delivery types. The installer and portable ZIP are the two ordinary-user product deliveries and share one versioned runtime bundle:

| Artifact | Audience | Includes | Must not include |
| --- | --- | --- | --- |
| Ordinary-user installer | teachers and other Windows users | writable runtime bundle, install/update/rollback contract, hash-bound manifest; Authenticode is optional | any repository-coupled package presented as a finished installer |
| Ordinary-user portable ZIP | teachers and other Windows users | self-contained runtime, extract-and-run launch, no registry writes | Git, PowerShell, .NET SDK or system Node.js requirements |
| `ClassroomToolkit-<version>-source.zip` | public developers | source, tests, scripts, prompt assets, lock files, `.env.example` | real `.env`, `node_modules`, local cache and delivery data |
| PrivateDev transfer ZIP | the private maintainer only | current working-tree snapshot and, only when explicitly requested, `.env` / `.git` / app | GitHub Release publication or any shared distribution channel |

## Public Release

本机生成的候选文件统一放在 Git 忽略的 `artifacts/deliveries/<version>/`；其中 `installer/stable/` 放普通用户安装程序及清单，`portable/` 放绿色版，`source/` 放公开源码包，`private-transfer/` 放按需私用迁移包，`_release-metadata/` 放版本清单、SBOM 和 provenance。历史证据和归档放在 `artifacts/history/<kind>/<date-or-id>/`，可重建中间物放在 `artifacts/work/<kind>/`，禁止跨层混放。清理旧版本及临时目录使用 `scripts/clean-artifacts.ps1 -KeepVersion <version>`。GitHub Release 才是公开下载入口，仓库不提交 ZIP、EXE、诊断输出或 SBOM 工具缓存。

Create an annotated tag named `v<major>.<minor>.<patch>` and push that tag.
The tag workflow performs the setup and integration gates, builds the installer
and portable ZIP, verifies both packages, generates the source ZIP and SPDX
SBOM, then uploads a 30-day candidate artifact. Authenticode signing is
optional; the stable candidate workflow does not require signing certificate
secrets. A tag run never publishes a GitHub Release.

A representative non-developer must install and repair the candidate, launch
the portable package, and render a Markdown answer to PDF from both package
types. After those checks, start **Release -> Run workflow** with the matching
version tag selected. Supply the successful candidate run ID and an acceptance
record containing the candidate's source commit and both package SHA-256 values
from the candidate run summary. The publish workflow downloads that exact
candidate and rejects a missing, stale, mismatched, or incomplete record before
writing release metadata, provenance, checksums, or a GitHub Release.

The acceptance record input has this shape; every package hash must come from
the candidate artifact the representative person actually tested:

```json
{
  "schemaVersion": "1.0",
  "kind": "classroom-toolkit-representative-acceptance-input",
  "status": "accepted",
  "version": "1.0.5",
  "sourceCommit": "<40-character candidate commit>",
  "candidateRunId": "<successful candidate run id>",
  "acceptedAt": "2026-10-13T12:00:00Z",
  "tester": {
    "identifier": "<approved tester name or public handle>",
    "role": "representative-non-developer"
  },
  "assets": {
    "installerSha256": "<tested setup EXE SHA-256>",
    "portableSha256": "<tested portable ZIP SHA-256>"
  },
  "scenarios": {
    "installerCleanInstall": "passed",
    "installerRepair": "passed",
    "installerMarkdownPdfDelivery": "passed",
    "portableLaunch": "passed",
    "portableMarkdownPdfDelivery": "passed"
  }
}
```

The workflow records the authenticated GitHub actor who submitted the record.
The tester identifier and non-developer role are human-supplied claims and must
be confirmed by the release owner; the workflow cannot establish a person's
role or prove that they performed the real-world checks. The automated
`test-ordinary-user-package.ps1` receipt remains engineering evidence and
cannot substitute for this record.

The existing `v1.0.1` Release is a legacy tag snapshot. Later versions are
represented only when their matching tag runs this workflow. Do not replace an
existing Release asset manually with a locally generated ZIP; the manifest, SBOM and
attestation must be produced by the same clean tagged source.

`<版本>` below is always the `<Version>` in
`src/ClassroomToolkit.App/ClassroomToolkit.App.csproj` (currently 1.0.4);
`package-release.ps1` rejects a mismatch.

The manifest binds each asset to a URL, byte count and SHA-256, plus a
`workspaceContract`. The installed WPF app only accepts a newer semantic
version, a matching runtime contract, and an installer asset hosted on GitHub
HTTPS. It verifies byte count and SHA-256 before launching setup for an
in-place upgrade. If the manifest declares a `publisherThumbprint`, the app
also verifies the Authenticode signature against it. Portable copies do not
self-replace while running; users download and extract the newer portable ZIP.
The updated app can move a signed installation to an unsigned release through
this GitHub HTTPS and SHA-256 path; that transition relinquishes its prior
Authenticode publisher pin for later updates. Apps from already published
signed releases still require Authenticode and cannot perform that first
unsigned update in-app. Users on those versions must download and run the
unsigned installer once; the updated app can then use the hash-verified
in-app update path.

`install-release.ps1`, after being downloaded from a GitHub Release, accepts
only GitHub HTTPS manifests and assets and verifies byte count and SHA-256
before launching Inno Setup (`-RunSetup` auto-starts). It also verifies
Authenticode when the manifest declares a `publisherThumbprint`. An unsigned
manifest must correspond to an unsigned installer. `-AllowLocalSimulation` is
an explicit test-only seam; the normal installer accepts only approved GitHub
HTTPS hosts and loopback is never an implicit production fallback.

`package-release.ps1` forwards to `build-ordinary-user-package.ps1`, which
builds both the setup EXE and portable ZIP from one runtime bundle. It builds
unsigned packages by default. A maintainer can provide
`-SigningCertificateThumbprint` to sign and verify the app and setup as an
optional publisher-identity signal. Stable publication remains blocked until
the matching candidate has a representative non-developer acceptance record.

Both ordinary-user packages seed a keyless `.env` (from the committed
`.env.example`) into the writable runtime root; the app health card points
there for the teacher's only setup step (own API key and
`CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true`). Installer upgrades and repairs
never overwrite an existing `.env` (`onlyifdoesntexist`), and uninstall
preserves it (`uninsneveruninstall`); acceptance asserts all three behaviors.

MIT does not require code signing. The release still publishes SHA-256
checksums, an SPDX SBOM and GitHub build provenance, and both the installer
and in-app updater verify the exact declared package bytes over approved GitHub
HTTPS endpoints. These checks identify the candidate bytes and build source;
they do not establish Windows publisher identity. Unsigned downloads may show
an “Unknown publisher” or SmartScreen warning. Authenticode can be enabled
optionally when publisher identity or a smoother Windows download experience
is desired.

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
  -Mode PublicSource -Version 1.0.3 -Output "D:\Transfer\ClassroomToolkit-source.zip"

# Current private working tree. Include secrets only with this explicit switch.
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/export-transfer.ps1 `
  -Mode PrivateDev -Version 1.0.3 -IncludeEnv -Output "D:\Transfer\ClassroomToolkit-private.zip"
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
