# Answer PDF tools

This folder contains the lightweight local toolchain used by the answer workflow.

## Render final answer PDF

```powershell
npm --prefix tools/latex-renderer run render -- "<答案.md>"
npm --prefix tools/latex-renderer run render -- "<答案.md>" --profile classroom
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
npm --prefix tools/latex-renderer run deliver -- "<答案.md>"
npm --prefix tools/latex-renderer run deliver -- "<答案.md>" --profile compact
```

This one command will:

1. render the answer Markdown to PDF;
2. generate repository-local review page images for the answer PDF;
3. keep temporary artifacts when render or review fails;
4. copy the complete review set to `<pdf-base>.review/` beside the PDF;
5. automatically clean transient artifacts when both steps succeed;
6. validate answer Markdown against baseline formatting rules before rendering;
7. persist `<pdf-base>.snapshot.json` beside the PDF instead of pointing long-lived delivery evidence at the mutable `.snapshot-cache`;
8. write and validate Delivery Manifest 1.1 integrity metadata for the input Markdown, PDF, delivery snapshot, and exact packaged review-file set.

The packaged `<pdf-base>.review/` directory is always retained. Use
`--keep-review` only when you also want to retain the repository-local
`.pdf-review/` debugging copy after a successful run.

The validator still accepts legacy manifest `1.0` files. New deliveries always
write `1.1`; changing any bound file after delivery causes validation to fail.

## Review source PDF pages

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "<试卷.pdf>"
```

The source-review command renders the original PDF pages into PNG files with
PDF.js inside local Chromium, Chrome, or Edge. By default the files are written under the
system temp folder, so the answer directory is not polluted by intermediate
page images.

Useful options:

```powershell
npm --prefix tools/latex-renderer run review-source-pdf -- "<试卷.pdf>" --pages 1,last
npm --prefix tools/latex-renderer run review-source-pdf -- "<试卷.pdf>" --out ".pdf-review/<试卷>"
npm --prefix tools/latex-renderer run review-source-pdf -- "<试卷.pdf>" --pages 1 --ocr chi_sim
```

For a measured real-paper failure, `--focus-regions-file <regions.json>` appends
bounded, ordered focused crops to the normal page or question views. The
descriptor uses normalized page rectangles, is bound to the exact source PDF
SHA-256, and may contain neutral source labels but no expected answers.
Focused crops are re-rendered from the PDF vector page at twice the requested
base scale (capped at 8x); ordinary page and question views keep the requested
scale.
An optional `analogMeter` block may add bounded source geometry: range,
division count, pivot, scale endpoint angles, and pointer search radii. The
renderer measures the continuous pointer ray and emits a value only when line
coverage and nearest-division residual both pass; otherwise it records
`uncertain`. The block cannot contain an expected answer.
Optional `linearScale` and `opticalRay` blocks cover the same narrow failure
class for straight scales and lens-ray diagrams. They contain only source
calibration endpoints or ray search segments. The renderer emits a calibrated
division or a before/after convergence relation only when the required pixels
are continuous and unambiguous; missing, disconnected, or competing evidence
is recorded as `uncertain` and must not be converted into an answer.
For straight scales, `indicatorMode: "continuous-fill"` follows a liquid
column from the calibrated start, while `"perpendicular-stroke"` locates a
single pointer crossing the calibrated axis and rejects a competing stroke.
`scripts/run-live-answer-workflow.ps1 -BlindFocusRegionsFile <regions.json>`
records the descriptor as a frozen workflow input and adds those source-bound
crops to the first blind-generation image set. The separate
`-VisualAuditFocusRegionsFile <regions.json>` option adds focused crops to the
no-reference visual audit renderer. Either option remains source evidence and
does not expose a reference answer.

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
Markdown, answer PDF, packaged `<pdf-base>.review/`, or runtime dependencies
like `node_modules` and `.tessdata`.

Useful options:

```powershell
npm --prefix tools/latex-renderer run cleanup -- --dry-run
npm --prefix tools/latex-renderer run cleanup -- --keep-review
npm --prefix tools/latex-renderer run cleanup -- .pdf-review/<试卷>
```

Recommended workflow:

1. Generate or update the answer `.md`.
2. Prefer `npm --prefix tools/latex-renderer run deliver -- "<answer.md>"`.
3. If rendering or review fails, keep the temporary artifacts for debugging.
4. If you ran the lower-level commands manually, run `cleanup` after acceptance.

## Validate answer Markdown

Before rendering, you can run the baseline answer-format gate directly:

```powershell
npm --prefix tools/latex-renderer run validate:answer -- "<答案.md>" --profile classroom
```

Current checks focus on the most common hard failures:

- choice-answer line format
- orphan question-number first lines
- backtick-wrapped math or units
- unbalanced LaTeX dollar signs
- unbalanced `\(...\)` / `\[...\]` LaTeX delimiters (`\(...\)` is normalized to `$...$` first; math inside code fences or inline code is exempt)
- dollar signs the renderer would leave as literal text (e.g. `$a$$b$`)
- LaTeX math failing the renderer's strict KaTeX contract
- executable raw HTML
- overly long plain-text lines as warnings

These automated checks are derived from the current v8.18 production spec and
now anchor to structured assets under `prompts/junior-physics-answer/` plus fixed eval
cases under `eval/junior-physics-answer/`.

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
