# RapidOCR CPU toolchain

This folder contains the heavier-but-still-local OCR path for poor scans and
batch work. It is intentionally separate from the default Tesseract.js helper.

## Environment

The virtual environment lives at `.venv/` and is ignored by git.

Recreate it if needed:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv tools/ocr/.venv
& tools/ocr/.venv/Scripts/python.exe -m pip install --upgrade pip setuptools wheel
& tools/ocr/.venv/Scripts/python.exe -m pip install -r tools/ocr/requirements.txt
```

## Workflow

First render the source PDF into page images:

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "习题PDF/能量-效率.pdf" --out "_ocr_work/能量-效率" --scale 2
```

Then run RapidOCR over the rendered page images:

```powershell
npm --prefix tools/latex-renderer run ocr:rapid -- "_ocr_work/能量-效率"
```

For poor scans, the default `--preprocess auto` runs OCR on both the original
page image and a cleaned copy, then keeps the higher-scoring result. Use
`--preprocess none` when speed matters and the source pages are already clean.

Main outputs:

- `rapidocr.md`: human-readable OCR review.
- `rapidocr.json`: full structured output.
- `rapidocr.jsonl`: one page per line for later processing.
- `text/*.txt`: one plain-text file per page.
