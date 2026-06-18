# Answer Graphics

Minimal answer-graphic pipeline for diagram-based answers.

## Smoke

```powershell
npm --prefix tools/answer-graphics run smoke
```

The first pass creates a structured figure asset, an answer graphic spec,
an overlay SVG, an artifact record, and a placed graphic record.

The core scripts write to `.answer-graphics/` by default. `npm run smoke`
stages the same artifact set in a temporary workspace unless
`ANSWER_GRAPHICS_ROOT` is set, so the repository tree stays clean.
