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

## 2026-08-20 追加：2022—2025 三档路由与语义复跑

### Route Contract And Timeout Root Cause

- 盲答主档保持 `gpt-5.6-sol / xhigh`；一次可重试失败后依次进入同模型 `high`、`medium`，每档只请求一次，任一 `terra` 配置均从 blind route 排除。
- 工作流传入的应用层 `TimeoutMs=600000` 没有被三档均分。当前 Node/Undici fetch 在约 305～307 秒未收到响应头时先返回 `UND_ERR_HEADERS_TIMEOUT`，早于 600 秒 AbortController 上限。4～5 MB `original` 请求在 xhigh 有成功也有超时，且同一输入在 high/medium 可成功；因此触发条件是请求负载、推理/排队时延与底层响应头时限的组合，不是 GPT-5.6 不支持 `original`。
- 旧实现对一次 headers timeout 在同档再发一次相同请求。2024 局部视觉审计实测两次 xhigh 分别等待 306.110 秒、306.153 秒后均超时，high 151.065 秒成功；这证明同档重试只增加等待。现已改为所有阶段每档一次，下一配置档恢复。
- 单档时长没有主动缩短：2023 xhigh 在 214.729 秒成功，2024 一次 xhigh 在 267.434 秒成功，2025 xhigh 在 284.064 秒成功。过早截断会把本可成功误判为失败，故保留当前单档机会。

### Fresh Live Receipts

- 2022 run `2b5002a2645441e2875cbc39dbeb3099`：blind `xhigh 305.614s headers timeout -> high 202.610s HTTP 200`；reference review xhigh HTTP 200；PDF SHA-256 `4580bfbc9e8b36ef3815b7fa87a3cf29f7dcf38ecb2dcc44646f75888e1a1400`。
- 2023 run `2a9a8a99d5f94722bb79fce8635d6c2e`：blind xhigh 214.729 秒 HTTP 200；reference review xhigh HTTP 200；PDF SHA-256 `3a19f33a31bc39f04481f794786c5947717d4e1ce743db66c641469392cad759`。
- 2024 fresh run `07359b5ffe57481c860b429245759dc2`：blind `xhigh 306.780s timeout -> high 306.474s timeout -> medium 166.465s HTTP 200`；三档均为 attempt 1；reference review xhigh 133.646 秒 HTTP 200；PDF SHA-256 `84d5531762440130ac6e3837225f13a37360260884c9e47a4d03c398e14983cb`。
- 2025 run `eba9b46e571d4c2db95a9c8c15c4bdf5`：blind xhigh 284.064 秒 HTTP 200；reference review xhigh HTTP 200；PDF SHA-256 `d6aa3a134d228ddd33d8e8af8038dcfbd131419b5cc6443fd7d3bdf78d9aaf84`。

### Blind Correctness Findings

- 2022：第 8 题 blind 选 C，权威答案为 D。高清题图清楚，错误是静电“吸引/排斥”判据与选项绑定，不是像素不足。其余差异主要为作图、实验步骤和公式表述。
- 2023：本次第 11(2) blind 再次写“等大”，权威为“缩小”；上一轮同样 `original + xhigh` 曾答对。相同输入的结果波动证明该题不能标记为稳定根治。
- 2024：整卷 `original` blind 仍把第 16 题读成 `n=2`，第 17 题读成 `0.16 A`，第 18 题读成 `4.0 cm / 4 个 / 2.0 N / 2.0 cm`；fresh medium 恢复运行也仍有第 17、18 题错误。
- 2025：第 8 题 blind 选 C，权威答案为 B；第 17 题三只电流表读成 `0.16 A`，权威为 `0.5 A`。普通计算题多数正确，但图中方向/仪表绑定仍不可信。
- 2024 六张题目级 4x crop 的独立 findings 正确识别第 16 题 `n=3` 和第 18 题 5 个钩码，却把第 17 题电流表读成 `0.8 A`；权威解析明确为 `0.6 A`。因此局部 crop 可改善部分视觉题，但 findings 也必须经 authority/教师复核，不能自动当真值 merge。

### Deterministic Delivery Repair

- 一次 2024 reference review 输出裸中文下标 `E_{k乙}`；旧 validator 只检查数学环境内中文标点，先报告通过，随后 KaTeX `strict: error` 以 `unicodeTextInMathMode` 失败。根因是 validator 与 renderer 的 LaTeX 接受集合不一致。
- gateway 现把脚标中的裸中文规范化为 `\text{...}`；validator 直接复用与 renderer 相同的 KaTeX strict 参数检查 `$...$`、`$$...$$` 和 `\[...\]`。focused 回归覆盖裸中文拒绝和 `\text{}` 接受。
- fresh 2024 run 随后完成 Markdown validation、KaTeX PDF render、3/3 page review、delivery-manifest write/validation，证明格式修复已进入真实主链；这不改变其 blind 语义错误结论。

### Current Boundary

- `repo_verified=true`、`three_tier_route_live_accepted=true`、`reference_reviewed_delivery_complete_2022_2025=true`。
- `blind_answer_trusted=false`、`targeted_visual_grounding_closed=false`、`teacher_or_classroom_accepted=false`。
- 当前最合理策略是保留 xhigh 完整单次机会，以 high/medium 仅做可用性恢复；语义提升应继续围绕题目/部件级定位、结构化读数和权威复核，不通过缩短单档时间、重复同档或继续扩写整卷提示词来解决。

## 2026-08-20 追加：单档 600 秒权威超时修复

- 根因 seam 是 Node 内置 fetch 的 Undici 默认 `headersTimeout=300000`，它早于工作流的 600 秒 AbortController，因而旧 live 样本在约 305～307 秒由 `UND_ERR_HEADERS_TIMEOUT` 提前终止。
- gateway 现固定使用项目依赖 `undici@8.10.0`，把 `headersTimeout`、`bodyTimeout` 设为应用层预算加 5 秒；默认单档回执为 `application=600000 / headers=605000 / body=605000 ms`，因此应用层总计时器先到期。连接建立继续使用短超时，不把断网或代理不可达拖到 600 秒。
- `-UseGatewayProxy` 路径由 `EnvHttpProxyAgent` 承接，保持 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`；直连路径使用 `Agent`。每个 attempt 回执新增脱敏 transport policy，便于证明运行时采用的真实预算和代理模式。
- fresh 2024 primary-only run `b7ad85e9fa094e8da82331440742f8e0` 使用 `gpt-5.6-sol / xhigh / original`：blind 在 265.328 秒 HTTP 200，reference review 在 127.186 秒 HTTP 200，均记录 `600000/605000/605000 ms` transport；最终 PDF SHA-256 `0e433fd599f7d045066a0f673317b905cee448c37009c0a00991ea64496c5b9f`，validator、3/3 review、manifest validation 完成。
- 本次请求没有自然跨过旧 305 秒边界，故 `transport_policy_live_applied=true`，但 `over_305_seconds_live_observed=false`；不能把 265 秒成功夸大为“已现场观察到请求跨过 305 秒”。显式 dispatcher 配置和 focused test 已关闭代码层提前截断原因，后续自然慢请求的 attempt receipt 继续承担 live 观察证据。
- 新一轮 blind 仍把第 16 题写成 `n=2`、第 17 题写成 `0.16 A`、第 18 题写成 4 个钩码；reference review 分别校正为 `n=3`、`0.6 A`、5 个钩码。因此超时修复提高可用性，不提升 blind 语义可信等级，`blind_answer_trusted=false` 保持不变。
