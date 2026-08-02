# 2026-08-01 真实 2024 广州中考答案工作流与视觉根因证据

## Goal

用 2024 广州中考物理原卷复现第 5、16、17、18 题错误，区分盲答、无参考答案视觉审计、权威参考复核和 PDF 排版四个边界；修复能由当前证据支持的输入链与审计契约，不把参考答案校正后的正确结果写成盲答根治。

## Confirmed Runtime

- 三次完整主链调用和多次有界探针均由 primary provider 返回 HTTP 200。
- 实际模型：`gpt-5.6-sol`。
- 实际 reasoning effort：`medium`。
- 请求 `visual-detail=original`；Responses provider 实际只接收 `high`。摘要现分别记录 `requestedVisualDetailMode=original` 和 `providerVisualDetailMode=high`。

## Root Cause

1. 旧主链是 `整卷 PDF -> 2x 整页图 -> 单次全文生成 -> 可选参考答案复核`。提示词虽要求“放大核对”，代码没有生成新的局部像素，也没有独立视觉请求。
2. 第 5 题原图清晰，错误属于候选锚定和缺少逐项反证；第 16-18 题同时受有效像素占比和视觉对象绑定影响。
3. 4x 整页仍不足；每页两个重叠高清视窗能在部分探针中纠正第 5、16、18 题，但结果不稳定。完整重跑中第 16-18 题仍沿用错误候选。
4. 将“视觉发现”和“全文改写”拆成两次请求仍未根治：发现报告本身把承重绳、接线柱、刻线和钩码识别错。缺失能力是题目级/部件级语义区域定位，以及可验证的结构化读数，不是更多同类提示词。
5. 第 17 题专用仪表裁图能识别实际连接 `-` 与 `3` 接线柱，却仍把解析版真值 `0.6 A` 读成 `0.7 A`。这证明局部高清图可以消除量程误判，但不能单独消除指针/刻线歧义。

## Changes

- `answer-request.mjs` 新增 `visual_audit_findings`、`visual_audit_merge` 和兼容的 `visual_audit` 模式，明确原卷审计图不是参考答案。
- 视觉提示要求选择题逐项反证、滑轮逐段追绳、仪表先追接线柱再读量程/刻度、刻度尺读两端、钩码逐个计数；证据不足必须 fail closed。
- live 摘要新增 audit image/findings 数量、路径、SHA-256，以及 requested/provider detail 两层事实。
- `review-source-pdf.mjs` 新增 1-4 个纵向视窗和可配置重叠，默认行为保持单张整页不变。
- `review-source-pdf.mjs` 进一步新增基于 PDF.js 文本层题号的 `--question-regions` 与 `--horizontal-tiles`：每道题生成左右 15% 重叠裁图，文件名包含 page、question、region 和 horizontal tile，续页继承上一题题号；默认整页行为保持不变。
- `run-live-answer-workflow.ps1` 默认生成 4x、题目级、左右两个、15% 重叠的视觉视窗，先提取视觉发现，再合并候选，最后才进入可选权威参考答案复核。
- `visual_audit_merge` 只应用同时具有明确视觉证据、计算链和“建议修正”的发现；“无需修正”或证据不足的项目保留盲答候选原文，防止未提供审计图的题目被替换为占位文本。
- 保留此前代理接入、底层 fetch 原因、选择题参考文本确定性覆盖、Markdown 前缀清理和真实字节 SHA-256 修复。

## 2024 Live Results

- 新完整主链输出：`正式交付/2024广州中考-GPT56Sol-medium-视觉审计主链实跑/`。
- 本次首轮盲答第 5 题为 C，但第 16 题仍为 `n=2`，第 17 题仍为 `0.16 A`，第 18 题仍为 `4.0 cm / 4 个 / 2.0 N / 2.0 cm`。
- 16 张 4x 重叠视窗的一次全文审计，以及后续 findings/merge 拆分探针，均未稳定纠正第 16-18 题。因此 `blind_root_cause_closed=false`。
- 题目级 4x 左右重叠裁图为 2024 全卷产出 50 张唯一文件；第 7 页页首归属第 17 题续页，第 8 页归属第 18 题续页。只输入第 5、16-18 题的 12 张裁图时，primary `gpt-5.6-sol + medium` 返回 HTTP 200，但仍判第 16 题 `n=2`、第 17 题 `0.16 A`、第 18 题 4 个钩码/`2.0 N`；仅将第 18 题原长和伸长改为 `3.0 cm` 与 `2.5 cm`。
- 50 张全量题目裁图的同一 visual findings 请求超过配置的 600 秒 provider 超时且无输出，已停止该次失效子进程；12 张关键回归图在约 65 秒内完成。因此全量题目裁图当前还存在请求规模/延迟限制，不能作为实时验收承诺。
- 修复前的 merge 会将未提供图像的第 1-4、6-10 题改为“视觉证据不足”；修复后真实 merge HTTP 200 保留两条选择题候选行，仅改动 findings 明示的第 18 题内容。
- 追加的部件事实结构化探针（复用现有 `vision-request` JSON-schema 入口、仅观察第 16 题绳段）没有进入模型：primary 返回 HTTP 503，fallback 返回 HTTP 502 `Upstream access forbidden`；两次均无 `TrackResult` 输出。随后对同一 primary、同一图片发送不带 JSON-schema 的最小 Responses 请求，仍返回 HTTP 502；因此不是 response-format 字段单独导致，也不是新的视觉正确性证据，不据此扩建 provider/schema 框架。
- 权威参考复核后的最终答案为：第 5 题 C；第 16 题 `n=3、3 m/s、1.5e4 W、60%`；第 17 题 `0-3 A、0.1 A/格、0.6 A`；第 18 题 `3.00 cm、5 个、2.5 N、2.50 cm`。
- 最终 Markdown/PDF 正确来自权威参考复核，不是无参考答案视觉审计根治。

## Verification

- `node --test tools/ai-gateway/answer-request.test.mjs tools/ai-gateway/answer-diff-report.test.mjs`：共 17 项回归通过（answer request 15 项、diff 2 项），其中包含 merge 对证据不足项目保留候选原文的合同断言。
- 题目级 renderer 已用 `node --check`、`git diff --check` 和 2024 原卷 4x 离线实跑验证；manifest 记录 50 个唯一 PNG 与题号/续页归属。
- PowerShell parse、renderer syntax 和 `git diff --check` 通过。
- 真实完整主链 exit 0：blind generation、visual audit、reference review 均由 `gpt-5.6-sol + medium` HTTP 200 完成；renderer validation、PDF 和 delivery manifest 生成成功。
- 2026-08-02 SDK 兼容切片完成后按固定顺序 fresh 重跑：`dotnet build ClassroomToolkit.sln -c Debug -p:UseSharedCompilation=false` exit 0（SDK 10.0.302，0 warning/0 error）；`dotnet test ... --no-build` exit 0（46/46）；`validate:assets` exit 0（99 个 core schemas、3 个 subject packs）；Full gate exit 0（201.19 秒，包含 cross-subject、PDF delivery smoke 和三科 eval）。此前精确 `10.0.301` 导致的 `platform_na` 已失效并关闭。

## Acceptance Boundary

- `repo_input_chain_improved=true`：有独立审计模式、4x 重叠视窗、findings/merge 分层和完整哈希证据。
- `blind_root_cause_closed=false`：2024 第 16-18 题真实无参考答案回归未通过。
- `reference_reviewed_delivery_correct=true`：最终交付经解析版复核并排版。
- `teacher_or_live_acceptance=false`：delivery manifest 仍保持 `trusted=false`、`visualReviewPassed=null`。
- PDF 三页没有裁切、重叠、乱码或公式溢出；第 17 题 Markdown 表格目前被 renderer 线性化为文本行，网格表格视觉呈现仍是独立排版缺口。
- 下一正确里程碑：接入真实题目/部件级 region proposal，分别建立滑轮绳段、仪表端子与刻线、刻度尺端点、钩码实例计数的结构化合同和 2024/2025 盲测基准；在此之前不得继续靠提示词、整页/题目级裁图或同类模型调用宣称视觉根治。
- 当前仓库基线明确不再维护旧 synthetic 视觉观察/语义投影链；在没有可用 provider endpoint、真实部件标注 authority 和 2024/2025 基准前，不把 synthetic contract 或一次性专用 detector 接回默认答案主链。

## Risk And Rollback

- 新视觉阶段增加一次图像审计和一次文本合并调用，带来延迟与 provider 成本；可用 `-SkipVisualAudit` 做旧链诊断，但该路径不可信。
- 纵向视窗是通用降采样缓解，不是语义 region solver。
- 回滚只撤销本证据列出的 gateway、renderer、workflow、测试、README 和本次交付目录；不得改动用户试卷资料或其他已有工作树内容。
