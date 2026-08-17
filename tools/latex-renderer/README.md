# Answer PDF tools

This folder contains the lightweight local toolchain used by the answer workflow.

## Render final answer PDF

```powershell
npm --prefix tools/latex-renderer run render -- "样例交付/能量-效率参考答案.md"
npm --prefix tools/latex-renderer run render -- "样例交付/能量-效率参考答案.md" --profile classroom
```

The renderer keeps LaTeX as real math by using Markdown-It, KaTeX, and a local
Chromium, Chrome, or Edge browser through Playwright.

Built-in render profiles:

- `classroom`: default; tuned for ordinary classroom projector readability.
- `compact`: tighter layout for relatively denser handout-style output.

Current structured profile files live under:

- `prompts/<subject-pack>/profiles/classroom.json`
- `prompts/<subject-pack>/profiles/compact.json`

## One-command deliver flow

For the repository-standard delivery flow after the answer Markdown is ready,
use:

```powershell
npm --prefix tools/latex-renderer run deliver -- "样例交付/能量-效率参考答案.md"
npm --prefix tools/latex-renderer run deliver -- "样例交付/能量-效率参考答案.md" --profile compact
```

This one command will:

1. render the answer Markdown to PDF;
2. generate repository-local review page images for the answer PDF;
3. keep temporary artifacts when render or review fails;
4. automatically clean transient artifacts when both steps succeed.
5. validate answer Markdown against baseline formatting rules before rendering.
6. persist `<pdf-base>.snapshot.json` beside the PDF instead of pointing long-lived delivery evidence at the mutable `.snapshot-cache`.
7. write and validate Delivery Manifest 1.1 integrity metadata for the input Markdown, PDF, delivery snapshot, and exact retained review-file set.

Use `--keep-review` when you want to retain the answer review page images for
manual re-checking after a successful run.

The validator still accepts legacy manifest `1.0` files. New deliveries always
write `1.1`; changing any bound file after delivery causes validation to fail.

## Review source PDF pages

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "样例交付/能量-效率.pdf"
```

The source-review command renders the original PDF pages into PNG files with
PDF.js inside local Chromium, Chrome, or Edge. By default the files are written under the
system temp folder, so the answer directory is not polluted by intermediate
page images.

Useful options:

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "样例交付/能量-效率.pdf" --pages 1,last
npm --prefix tools/latex-renderer run review-source-pdf -- "样例交付/能量-效率.pdf" --out ".pdf-review/能量-效率"
npm --prefix tools/latex-renderer run review-source-pdf -- "样例交付/能量-效率.pdf" --pages 1 --ocr chi_sim
```

OCR is explicit and optional. It uses Tesseract.js on the rendered page images,
with language data cached in `.tessdata/`, so it is suitable only as an
auxiliary check. When OCR conflicts with the page image, the page image remains
the source of truth.

## Clean transient artifacts

After a successful answer delivery and visual review, clean repository-local
temporary artifacts with:

```powershell
npm --prefix tools/latex-renderer run cleanup --
```

This removes known transient outputs such as:

- `.pdf-review/`
- `_ocr_work/`
- explicitly targeted `_tmp_*`
- explicitly targeted `*.render.html`

It does **not** remove final deliverables such as the original PDF, answer
Markdown, answer PDF, or runtime dependencies like `node_modules` and `.tessdata`.

Useful options:

```powershell
npm --prefix tools/latex-renderer run cleanup -- --dry-run
npm --prefix tools/latex-renderer run cleanup -- --keep-review
npm --prefix tools/latex-renderer run cleanup -- .pdf-review/能量-效率
```

Recommended workflow:

1. Generate or update the answer `.md`.
2. Prefer `npm --prefix tools/latex-renderer run deliver -- "<answer.md>"`.
3. If rendering or review fails, keep the temporary artifacts for debugging.
4. If you ran the lower-level commands manually, run `cleanup` after acceptance.

## Validate answer Markdown

Before rendering, you can run the baseline answer-format gate directly:

```powershell
npm --prefix tools/latex-renderer run validate:answer -- "样例交付/能量-效率参考答案.md" --profile classroom
```

Current checks focus on the most common hard failures:

- choice-answer line format
- orphan question-number first lines
- backtick-wrapped math or units
- unbalanced LaTeX dollar signs
- overly long plain-text lines as warnings

These automated checks are derived from the current v8.15 production spec and
now anchor to structured assets under `prompts/junior-physics-answer/` plus fixed eval
cases under `eval/junior-physics-answer/`.

## Smoke test

Run a minimal end-to-end smoke check for:

- answer validation
- classroom render
- compact render
- classroom review rendering

```powershell
npm --prefix tools/latex-renderer run smoke
```

## Minimal visual regression

The repository now includes a lightweight first-page regression for the smoke
fixture:

```powershell
npm --prefix tools/latex-renderer run visual:smoke
```

Behavior:

- first run creates baseline images for both `classroom` and `compact`;
- later runs compare the current first-page render against those baselines;
- failure indicates a visual change large enough to inspect manually.

## Eval suite

Run the fixed prompt-asset regression suite with:

```powershell
npm --prefix tools/latex-renderer run eval:answer
```

This reads `eval/junior-physics-answer/dataset.json`, runs validator checks for each
listed case/profile pair, and writes a local summary to
`eval/junior-physics-answer/results/latest.json`.

For another subject pack, pass `--subject-pack <name>` and the evaluator will
default to `eval/<name>/dataset.json`.

Within one subject eval, each profile snapshot is compiled once and all
render/review subprocesses connect to one short-lived local browser server.
Standalone `render`, `review-source-pdf`, and `deliver` commands remain
self-contained. The math suite keeps delivery coverage on the two-profile smoke
case; its other cases retain validator and visual-baseline coverage without
repeating the same no-graphics manifest contract.
