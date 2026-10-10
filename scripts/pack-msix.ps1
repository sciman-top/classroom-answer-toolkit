#requires -Version 7
param(
    [string]$PublishDir = "artifacts\work\publish\ClassroomToolkit.App",
    [string]$StageDir = "artifacts\work\msix\stage",
    [string]$PackageDir = "artifacts\work\msix\packages",
    [string]$SmokeReportPath = "",
    [string]$Version = "1.0.0.0",
    [string]$Publisher = "CN=ClassroomToolkit.Dev"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# MSIX packaging stays blocked: the WPF executable is a repository-coupled
# companion and the publish tree intentionally excludes the mutable repository
# toolchain, Node.js/npm, PowerShell, prompts, snapshots, and eval state. A
# package would misrepresent the current publish/smoke results as a
# self-contained installable product. Revisit only when a writable, versioned
# runtime bundle has its own install and upgrade contract (the parameters
# above remain the future entry contract, so callers fail here rather than on
# unknown arguments).
throw (("MSIX packaging is blocked: the WPF executable is a repository-coupled companion and the publish tree intentionally excludes " +
    "the mutable repository toolchain, Node.js/npm, PowerShell, prompts, snapshots, and eval state. " +
    "Creating {0} in {1} would misrepresent it as a self-contained installable product. " +
    "Keep stage path {2} unused until a writable, versioned runtime bundle has its own install and upgrade contract.") -f $Version, $PackageDir, $StageDir)
