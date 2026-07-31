# 2025 Guangzhou Live Answer Workflow Evidence

## 2026-07-31 GPT-5.6 Sol medium repair run (supersedes earlier delivery claim)

The earlier two-page delivery statement below is historical evidence only. It must not be read as the current acceptance result: a new live run exposed raw LaTeX leakage when a model put an inline `$...$` formula across multiple Markdown lines.

- Primary text/vision provider was configured and live-proven as `gpt-5.6-sol` with reasoning effort `medium`; both blind generation and reference review returned HTTP 200 with those exact fields in their summaries.
- The official three-page reference PDF remained the semantic authority. Its text layer supplied the unique choice sequence `BAADA CBBDD`; review output now deterministically applies that only to the required `1—5` and `6—10` lines, and fails if either source or target shape is ambiguous.
- The blind candidate still differed materially (question 8, question 11 energy form, question 17 values/table, and question 18 answer sequence). It is retained for comparison, not marked trusted.
- The renderer root cause was `replaceMath` using an inline fence pattern that rejected line breaks. A red regression test rendered a multiline `$t=\\frac{W}{P}...$` input and extracted raw `$`, `\\frac`, and `\\mathrm` from the PDF. The replacement now accepts the paired fence across lines; the green regression test proves the extracted PDF text contains no LaTeX source.
- Validator defense-in-depth now rejects CJK punctuation written directly inside math fences before KaTeX, while the answer formatter only removes fences around a narrow `A、B`-style point-label list.
- Human prompt source adds two focused requirements: preserve circled subquestion positions/numbering and keep labels/punctuation outside `$...$`. Generated prompt assets were reassembled from this source.

Current untracked live artifacts, after re-render and visual inspection of all three review pages:

| Artifact | SHA-256 |
| --- | --- |
| `正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考盲答候选.md` | `c6dfeb3a4ac240e675f8d142a3d6cdd2025996306203815148727f60050a18d9` |
| `正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.md` | `78275489329062c3b4662d94e29e71bffce545055ec5fa88ad94abdb5338e251` |
| `正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.pdf` | `c3cbf510bc2455ca5af8abd278cc97f9586a8ba490a2b46900656e9ba39851ff` |
| `正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.delivery-manifest.json` | `1d554e2e15fec8b4919a604adabea0a40ea50154ca81d98b4b2392ef81650ea5` |

The current PDF has no visible raw LaTeX, clipping, overlap, or garbling. Six long-CJK-line warnings remain non-blocking layout debt. The delivery manifest deliberately keeps `trusted: false`: a correct reference-based revision is a delivery candidate, while semantic acceptance remains a teacher decision.

## Goal and truth boundary

- Goal: prove the shortest real workflow `source PDF -> v8.14 full prompt + AI -> answer Markdown -> validated PDF/review`, then compare against the official reference answer and repair real defects.
- Source exam: local untracked asset `广州物理中考试卷/2025广州中考.pdf`, 8 pages.
- Reference truth: local untracked asset `广州物理中考试卷/2025广州中考（答案）.pdf`, 3 pages; it was not sent during blind generation.
- Runtime prompt: `prompts/junior-physics-answer/spec.md`, v8.14, SHA-256 `5971492f1175d56676e8085189b0a96fa0baeb0e085b9d4ebb3c5c4499b909d6`.
- Live provider result: primary `gpt-5.5`, HTTP 200 for the initial blind runs and the later reference-review run.
- Not claimed: either blind candidate was correct enough for automatic trusted delivery. The corrected final answer uses the official reference answer after blind evaluation.

## Real run results

First blind candidate SHA-256: `0dc3dbe8620a61ecb0467dfd7102266bfe8289caccb209fdcf2cd6abc1a931c7`.
It got most ordinary calculation items right but missed question 8, used device names instead of energy forms in question 11, omitted question 17 coverage, and misread the question 17 voltage/current values.

The live task prompt was then tightened without editing the 100 KB v8.14 human specification. It now requires an internal question/subquestion/blank inventory, explicit visual tracing, range/terminal/division checks, and physical-term checks. The focused prompt/request suite increased from 5 to 6 tests.

Second blind candidate SHA-256: `8d950c7901a1ca1f539631424796cd748a57e15a5f6449c0f4227b5de7687a1d`.
It corrected question 8 but regressed other choices and produced larger errors in questions 12, 17, and 18. This proves that prompt prose alone does not make one-shot whole-exam vision deterministic or trustworthy.

The final checked delivery is therefore explicitly `blind candidate -> reference/manual comparison -> corrected Markdown -> PDF`, not a claimed one-shot model answer.

### Authoritative-reference correction

The earlier manual correction was itself not authoritative enough: it recorded the selected-answer suffix as `C、B、D、D、D` and shifted the question-18 circle numbering. A later direct re-review used the same official answer PDF's three rendered page images and text layer. The official first page visibly and textually reads `BAADA CBBDD`; this means the correct 6—10 answers are `C、B、B、D、D`, not `C、B、D、D、D`. The reference-review run returned HTTP 200 from `gpt-5.5` and agrees with the official page images on questions 11, 12, 17, and 18. The formal delivery was replaced by that rechecked Markdown and re-rendered.

## Delivered artifacts

| Artifact | SHA-256 |
| --- | --- |
| `正式交付/2025广州中考/2025广州中考参考答案.md` | `0fd5e9ff75591db47a4153e914e564d44f47fc4163ebd669b4c795d97237241b` |
| `正式交付/2025广州中考/2025广州中考参考答案.pdf` | `8794d70f25490b1ae0eda142dd6ead2d3d0c2a0efdc1ee2a3de26c647e56d204` |
| `正式交付/2025广州中考/2025广州中考参考答案.delivery-manifest.json` | `1cd328123c570471114beb3a89c5f27af23fbaeb082fab1c9508afec24a941f5` |

The final PDF contains 2 pages. Both pages were rendered to PNG and visually inspected after the last Markdown update. Formula rendering, table readability, pagination, clipping, overlap, and raw-LaTeX leakage were checked; no visual defect was observed. The renderer emitted three non-blocking long-CJK-line wrapping warnings.

## Implementation and root-cause fixes

- Added `tools/ai-gateway/answer-request.mjs` and contract tests for ordered multi-page Responses/Chat Completions requests, provider failover, dual cloud-egress gates, Markdown normalization, and output hashing.
- Added `scripts/run-live-answer-workflow.ps1` as the thin orchestration path. Cloud egress is enabled only in the child process and `.env` is not modified.
- Added answer and renderer tests to `scripts/check-toolchain.ps1`.
- Root-caused Windows native exit `-1073740791` to Node 24 `fs.rmSync` on ordinary files under the Chinese delivery path. The browser had already completed `page.pdf()` and `browser.close()` before the crash.
- Renderer temporary PDF/HTML names are ASCII. Final PDF commit uses `copyFileSync + unlinkSync`; ordinary HTML and manifest lock files use `unlinkSync`. Shared lock competition and hardlink semantics remain covered by 59 aggregate tests.
- The synthetic visual/OCR evidence branches referenced by earlier drafts were later removed because they do not participate in this product's answer-delivery path.

## Fixed-order verification

System-installed SDKs did not include exact `10.0.301`. Verification used the existing `%TEMP%/classroom-toolkit-dotnet-10.0.301` runtime by setting `DOTNET_ROOT` and prepending `PATH` only inside gate processes. No SDK was installed; `global.json` was unchanged.

| Order | Command | Result |
| --- | --- | --- |
| 1 | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0; 0 warnings, 0 errors |
| 2 | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug` | exit 0; 40 passed, 0 failed, 0 skipped |
| 3 | `npm --prefix tools/rule-compiler run validate:assets` | exit 0; 16 core schemas, 3 subject packs, compiled assemblies, snapshots, and renderer contracts |
| 4 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1` | exit 0 in 287.8 seconds; `Answer generation and layout toolchain check complete.` |

Focused evidence includes answer request 8/8, Unicode renderer output 3/3, all three subject-pack answer-layout evals, and final live delivery-manifest validation.

## Product decision and rollback

The project was over-weighted toward governance while the thin real generation entrypoint was missing. The accepted correction is to keep the existing deterministic renderer/contracts but make the full-prompt live CLI the shortest entrypoint. Do not add more prompt prose as the primary accuracy strategy; next accuracy work should be reference comparison and local high-resolution question crops.

Rollback only this slice: remove the live workflow/request files and package/check-toolchain entries, restore renderer/manifest-lock file deletion behavior, and remove the 2025 delivery/evidence artifacts. Preserve the user's original exam/reference directory, `.env`, provider settings, and existing subject-pack assets.
