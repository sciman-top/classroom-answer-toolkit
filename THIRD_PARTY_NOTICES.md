# Third-Party Notices

Classroom Answer Toolkit source code is distributed under the MIT License in
[`LICENSE`](./LICENSE). Third-party packages retain their own licenses. This
notice records the direct application and toolchain runtime packages observed
from the locked local install. Release application archives also include the
license and notice files supplied by the exact restored .NET runtime packs and
CommunityToolkit.Mvvm package.

| Package | Locked local version | License |
| --- | ---: | --- |
| Microsoft .NET Runtime / Windows Desktop Runtime | 10.0.x | MIT and bundled third-party notices |
| `CommunityToolkit.Mvvm` | 8.4.0 | MIT |
| `undici` | 8.10.0 | MIT |
| `katex` | 0.16.47 | MIT |
| `markdown-it` | 14.3.0 | MIT |
| `pdfjs-dist` | 6.2.108 | Apache-2.0 |
| `playwright-core` | 1.60.0 | Apache-2.0 |
| `tesseract.js` | 7.0.0 | Apache-2.0 |

Release automation does not copy `node_modules`; new machines restore the
locked dependencies with `npm ci`. Consumers who redistribute a modified or
bundled form must retain all applicable third-party notices and license texts.
