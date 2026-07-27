param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("materialize", "validate", "test")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot "..\ocr\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "OCR Python environment is missing: $python"
}

switch ($Action) {
    "materialize" { & $python (Join-Path $PSScriptRoot "visual_structure_extractor.py") --materialize-fixtures }
    "validate" { & $python (Join-Path $PSScriptRoot "visual_structure_extractor.py") --validate-fixtures }
    "test" { & $python -m unittest discover -s $PSScriptRoot -p "test_*.py" -v }
}

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
