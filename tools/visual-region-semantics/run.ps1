param(
    [Parameter(Mandatory = $true)]
    [string]$Request,
    [Parameter(Mandatory = $true)]
    [string]$Out
)

$ErrorActionPreference = "Stop"
python (Join-Path $PSScriptRoot "visual_region_semantics.py") --request $Request --out $Out
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
