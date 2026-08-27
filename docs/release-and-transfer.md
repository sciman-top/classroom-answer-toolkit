# Release and Transfer

## Scope

This repository distributes three intentionally separate artifacts:

| Artifact | Audience | Includes | Must not include |
| --- | --- | --- | --- |
| `ClassroomToolkit-<version>-win-x64.zip` | ordinary Windows users | published WPF application | real `.env`, private papers, delivery outputs, `.git` |
| `ClassroomToolkit-<version>-source.zip` | public developers | source, tests, scripts, prompt assets, lock files, `.env.example` | real `.env`, `node_modules`, local cache and delivery data |
| PrivateDev transfer ZIP | the private maintainer only | current working-tree snapshot and, only when explicitly requested, `.env` / `.git` / app | GitHub Release publication or any shared distribution channel |

The ordinary app remains a repository-coupled companion. Its initial install
therefore fetches the matching source workspace and initializes the supported
toolchain. It is not a claim of an offline, self-contained MSIX product.

## Public Release

Create an annotated tag named `v<major>.<minor>.<patch>` and push that tag.
The GitHub Actions workflow performs the local setup gate, creates the app and
source ZIPs, writes `update-manifest.json`, and publishes those assets plus
`scripts/install-release.ps1` to the GitHub Release.

The manifest binds each asset to a URL, byte count and SHA-256. The WPF app
only accepts a newer semantic version and an app asset hosted on GitHub HTTPS.
The updater verifies the downloaded ZIP before it extracts it, waits for the
main process to exit, moves the old app directory to a timestamped backup,
starts the replacement, and restores the backup if replacement fails before
restart.

No code-signing certificate is configured by this repository. SHA-256 is an
integrity check for the published Release asset; it is not a substitute for a
publisher identity signature. Before distributing to non-developer users,
configure Authenticode signing in a protected CI secret and extend the release
gate to verify the signature.

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
rejects archive traversal and integrity drift. It moves an existing target to
a timestamped backup before placing the new package; if import fails before
completion it restores that backup.

Private packages can contain plain-text API keys. Store and transfer them only
through an encrypted, maintainer-controlled channel. Rotate any provider key
that is exposed to a shared drive, repository, chat, issue tracker, or Release.

## Rollback

The app updater retains the previous `app` directory alongside the active one
with a timestamped `.backup.<utc>` suffix. A failed replacement restores the
backup automatically. Transfer import uses the same move-first backup model
for an existing target. These automatic backups do not replace a source-control
commit or a separate backup of user papers and completed deliveries.
