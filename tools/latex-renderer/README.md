# Physics answer PDF tools

This folder contains the lightweight local toolchain used by the answer workflow.

## Render final answer PDF

```powershell
npm --prefix tools/latex-renderer run render -- "习题PDF/能量-效率参考答案.md"
```

The renderer keeps LaTeX as real math by using Markdown-It, KaTeX, and a local
Chrome or Edge browser through Playwright.

## Review source PDF pages

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "习题PDF/能量-效率.pdf"
```

The source-review command renders the original PDF pages into PNG files with
PDF.js inside local Chrome or Edge. By default the files are written under the
system temp folder, so the answer directory is not polluted by intermediate
page images.

Useful options:

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "习题PDF/能量-效率.pdf" --pages 1,last
npm --prefix tools/latex-renderer run review-source-pdf -- "习题PDF/能量-效率.pdf" --out ".pdf-review/能量-效率"
npm --prefix tools/latex-renderer run review-source-pdf -- "习题PDF/能量-效率.pdf" --pages 1 --ocr chi_sim
```

OCR is explicit and optional. It uses Tesseract.js on the rendered page images,
with language data cached in `.tessdata/`, so it is suitable only as an
auxiliary check. When OCR conflicts with the page image, the page image remains
the source of truth.
