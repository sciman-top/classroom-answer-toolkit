# Answer Graphics

Minimal answer-graphic pipeline for diagram-based answers.

Current staged flow:

1. `extract-figure.mjs` writes `problem-figure-asset.json`
2. `understand-figure.mjs` writes `figure-understanding-result.json`
3. `build-graphic-spec.mjs` writes `answer-graphic-spec.json`
4. `render-graphic-overlay.mjs` writes the overlay and artifact records
5. `compose-answer-graphic.mjs` writes `placed-answer-graphic.json`

## Smoke

```powershell
npm --prefix tools/answer-graphics run smoke
```

The first pass creates a structured figure asset, a figure-understanding
record, an answer graphic spec, an overlay SVG, an artifact record, and a
placed graphic record.

The core scripts write to `.answer-graphics/` by default. `npm run smoke`
stages the same artifact set in a temporary workspace unless
`ANSWER_GRAPHICS_ROOT` is set, so the repository tree stays clean.
