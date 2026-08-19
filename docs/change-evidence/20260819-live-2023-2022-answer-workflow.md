# 2026-08-19 真实 2023、2022 广州中考答案工作流证据

## Goal

沿当前真实主链执行 2023、2022 广州中考物理原卷盲答、权威参考复核与 PDF 交付，区分盲答正确性、参考校正后的交付完整性和教师验收；同时修复实跑暴露的 Windows Unicode 文件清理故障。

## Runtime And Results

- 2023 成功 run `52721ec8bd904e52837be775c5fdd4a1`：原卷 8 页、参考答案 2 页；blind generation 与 reference review 均由 primary `gpt-5.6-sol / xhigh` 返回 HTTP 200。最终 PDF 3 页，SHA-256 `916063345d271a76b535cd3ceff14ada3c689da4fd90c5a8dc75856f2f577217`。
- 2023 选择题盲答与参考文本序列一致。明确语义错误是第 11(2) 成像性质：盲答写“等大”，参考复核改为“缩小”；其余差异主要是作图说明、推导展开和第 18 题取舍理由的表达变化。
- 2022 首次请求在 headers 阶段以 `UND_ERR_HEADERS_TIMEOUT` 失败，没有模型结果；一次有界重试成功，run `c4a7a94fb5a54bb692c58e0a8bdc41b4`。原卷 8 页、解析参考 18 页；两阶段均由 primary `gpt-5.6-sol / xhigh` 返回 HTTP 200。最终 PDF 2 页，SHA-256 `fd4cd45ed08426ae18b14053f491d3a653bfc0bff438088b4fca9eac2163651f`。
- 2022 选择题、数值计算和主要结论未见参考复核后的实质反转；差异主要是规范化作图说明、补全实验步骤和推导表达。

## Root Cause And Changes

1. 2023 首次 live run 已写出完整盲答，但 Node 24 在 Windows 中文路径上对 rename 后不存在的临时文件执行 `fs.rmSync` 时 native crash，exit `-1073740791`，summary 未写。
2. 修复原子写后，delivery 又在删除中文 review 目录树时以同一 native code 崩溃。独立 reproducer 已证明 PDF 和 2/2 review 页均已生成，故障位于 cleanup，不在 AI、Markdown、KaTeX 或 Chromium 渲染。
3. 新增小型 `removePathRecursive`，以 `lstat/readdir/unlink/rmdir` 处理文件、符号链接和目录；原子写、delivery 预清理与 transient cleanup 统一使用该 seam。嵌套中文目录和中文原子写回归通过。
4. 当前 OpenAI Images and vision 文档说明 GPT-5.6 支持 `original`，且该模式保留输入尺寸，适用于小目标、OCR、定位和空间敏感任务。gateway 现仅对 `gpt-5.6-*` 保留请求的 `original`，旧兼容模型继续映射到 `high`。
5. `original` 的真实 provider acceptance 探针在 headers 阶段超时，没有模型结果。因此当前只证明 request contract 已更新，不能宣称 2023 第 11 题或 2024 视觉错题已根治。

## Verification

- 2023、2022 成功 workflow receipt 均为 `status=succeeded`；blind generation、reference review、delivery 均 completed。
- 共享原子写/cleanup 修复后的 2023、2022 delivery 均完成 Markdown validation、PDF render/review、cleanup、manifest write 和 manifest validation。
- `node --test tools/ai-gateway/answer-request.test.mjs tools/ai-gateway/answer-diff-report.test.mjs tools/latex-renderer/pdf-output-path.test.mjs`：32/32 通过。
- `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer`：exit 0；10 个 core schema、3 个 subject pack、spec boundary、compiled assets 与 classroom/compact snapshots 通过。
- 最终 PDF 重新渲染为 2023 的 3 页和 2022 的 2 页并逐页视觉抽查；未见裁切、重叠、乱码或裸 LaTeX。末页留白较多但没有内容丢失。
- `git diff --check`：通过。

## Acceptance Boundary

- `repo_verified=true`：代码、focused tests 和 Core gate 已通过。
- `2023_reference_reviewed_delivery_complete=true`、`2022_reference_reviewed_delivery_complete=true`：参考复核后的 Markdown/PDF/manifest 已生成。
- `blind_answer_trusted=false`：2023 存在明确视觉语义错误；2022 的一次成功样本也不足以建立自动可信。
- `original_detail_live_accepted=false`：当前 provider 探针超时，无成功 receipt。
- `teacher_or_classroom_accepted=false`：delivery manifest 的 `reviewArtifactReady=false`，没有教师现场验收。
- 不因单个 2023 视觉错误扩建通用 OCR/layout 平台；部件级定位仍受 `VISION-101` 的 authority、provider 稳定性和预算条件约束。

## Sources And Rollback

- OpenAI Images and vision: <https://developers.openai.com/api/docs/guides/images-vision>
- Node.js File system API: <https://nodejs.org/api/fs.html#fsrmsyncpath-options>
- Microsoft WPF overview for .NET desktop: <https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/>
- 回滚只撤销本切片的 safe-remove、gateway detail、对应回归测试、2023/2022 交付目录和本证据；保留用户原卷、参考答案、`.env` 与 provider 配置。
