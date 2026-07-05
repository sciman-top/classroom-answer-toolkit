# Answer Graphics

Experimental controlled-graphic pipeline for reviewed diagram assets.

## Positioning

This toolchain is no longer a default product requirement.

- It is **experimental**
- It is **not** part of the main delivery promise
- It is intended for **user-supplied** or **human-reviewed** graphic assets
- The main answer workflow must remain usable without this toolchain

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
