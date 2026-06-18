# Answer Graphics

Minimal answer-graphic pipeline for physics diagram answers.

## Smoke

```powershell
npm --prefix tools/answer-graphics run smoke
```

The first pass creates a structured figure asset, an answer graphic spec,
an overlay SVG, an artifact record, and a placed graphic record.

The current smoke output is a structured artifact set under `.answer-graphics/`;
PDF placement integration is the next step after the core graph planning layer.
