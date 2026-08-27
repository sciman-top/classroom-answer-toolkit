# Third-Party Notices

Classroom Answer Toolkit source code is distributed under the MIT License in
[`LICENSE`](./LICENSE). Third-party packages retain their own licenses. This
notice records the direct runtime packages observed from the locked local
install; complete transitive notices remain in the package metadata and the
installed `node_modules` trees.

| Package | Locked local version | License |
| --- | ---: | --- |
| `undici` | 8.10.0 | MIT |
| `katex` | 0.16.47 | MIT |
| `markdown-it` | 14.3.0 | MIT |
| `pdfjs-dist` | 6.2.108 | Apache-2.0 |
| `playwright-core` | 1.60.0 | Apache-2.0 |
| `tesseract.js` | 7.0.0 | Apache-2.0 |

Release automation does not copy `node_modules`; new machines restore the
locked dependencies with `npm ci`. Consumers who redistribute a modified or
bundled form must retain all applicable third-party notices and license texts.
