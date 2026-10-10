#requires -Version 7
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$WorkspaceContract = "2",
    [string]$OutputDirectory = "artifacts\deliveries",
    [string]$IsccPath = "",
    [string]$SigningCertificateThumbprint = "",
    [switch]$SkipPublish,
    [switch]$AllowUnsignedCandidate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Thin forwarder: the ordinary-user installer/portable chain owns release
# packaging end to end. The former developer-operator-preview channel
# (workspace zip installs and schema 1.0 update manifests) has been retired;
# recover it from Git history if it is ever needed again.
$arguments = @{
    Version = $Version
    WorkspaceContract = $WorkspaceContract
    OutputDirectory = $OutputDirectory
    IsccPath = $IsccPath
    SigningCertificateThumbprint = $SigningCertificateThumbprint
    SkipPublish = $SkipPublish
    AllowUnsignedCandidate = $AllowUnsignedCandidate
}
& (Join-Path $PSScriptRoot "build-ordinary-user-package.ps1") @arguments
# A .ps1 invoked with & never sets $LASTEXITCODE; build-ordinary fails via
# throw, which Stop preference propagates before this line is reached.
exit 0
