# Visual Preprocessor

This tool implements the VISION-007 provider-neutral local preprocessing
contract. It accepts only inventory-admitted public `synthetic_fixture` PNG
inputs with explicit integer `page_pixel` bounds, scales `[1, 2]`, and cloud
egress disabled.

- Pillow decodes deterministic RGB pixels and encodes PNG artifacts.
- OpenCV produces the fixed `INTER_NEAREST` 2x crop.
- Source, request, result, and crop raw bytes are SHA-256 bound.
- Source and crop decoded RGB pixels are independently SHA-256 bound.
- Runtime output must be a new directory outside the repository.
- The tool performs no OCR, layout inference, region detection, network call,
  answer generation, trust update, or optimization.

```powershell
npm --prefix tools/visual-preprocessor test
npm --prefix tools/visual-preprocessor run validate:fixtures
```

`materialize:fixtures` is a repository-maintenance command that regenerates
only the three committed synthetic fixture bundles. It is not a live input
entry point.
