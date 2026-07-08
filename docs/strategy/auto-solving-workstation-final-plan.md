# Auto-Solving Workstation Final Plan

## 1. 定位

终局产品形态是 **自动解题工作站**，不是单一提示词、单一渲染脚本或单一视觉模型。

它的目标是把 `原题 -> 证据 -> 候选答案 -> 风险决策 -> review -> 可信交付` 做成同一条本地优先、可追踪、可回放的工作流。

当前已成熟链路仍是：

- `answer.md -> PDF/review`

终局新增主链是：

- `原题 -> answer.md`

两条主链必须保持接口分离。新增自动解题能力不能藏进现有 deliver 工具，也不能把 `answer.md -> PDF/review` 的成功误报成“原题自动解题已可信”。

## 2. 终局工作站模块

### 输入与证据层

- 视觉证据编译器是自动解题工作站的第一道主链，不是可选辅助。
- PDF / 图片 / 扫描件进入 `NormalizedPage`。
- 题区、图区、表格区、公式区、坐标轴、刻度、图例、局部 crop 进入 `VisualRegion`。
- 每个视觉相关小问形成 `ProblemEvidenceBundle`，必须尽量追踪到 `questionRef -> figureRef -> cropRef -> evidenceRef`。
- OCR、layout、图元抽取、页图和局部 crop 都是证据，不是最终答案。

### 自动解题层

- Track A：VLM 直看原页和局部高清 crop。
- Track B：OCR / layout / 图元结构化后求解。
- Track C：规则校验器，拦截单位、量程、分度值、坐标轴、图号绑定、答案格式和学科约束错误。
- Track 输出统一记录为 `TrackResult`。

### 风险与决策层

- 高风险视觉题默认 fail-closed。
- 双轨一致但证据链缺失，仍保持 `trusted=false`。
- 最终决策写入 `DecisionRecord`，并投影到 delivery manifest 的 `visualReviewPassed` 与 `trusted`。

### Review 工作台

- WPF 展示原页、局部 crop、OCR/layout 片段、Track A/B/C 候选、冲突点、缺失证据和疑点原因。
- 教师可批准、退回、修正或标记真值存疑。
- review 结果必须回写 manifest、`DecisionRecord` 和后续 eval 回放资产。

### 渲染与交付层

- 当前运行时仍保持 Playwright / Chromium。
- 终局目标是 Typst 主渲染，详见 [typst-primary-renderer-plan.md](./typst-primary-renderer-plan.md)。
- 渲染层必须通过 renderer contract，不能只按“能导出 PDF”判断完成。

## 3. 产品边界

### 当前可以承诺

- 本地优先的答案交付工作站。
- subject-pack、snapshot、compiled spec、eval 的资产治理。
- 高风险视觉题可降级、可复核、可回放。
- 视觉证据契约层、显式 Track A 网关探针、最小离线 `DecisionRecord` 编译器和 fail-closed 样例已落盘。

### 终局目标

- 自动解题工作站：支持从原题材料进入证据编译、自动候选、风险决策、review 和可信交付。
- Typst 主渲染：以 Typst 作为最终 PDF 主后端，并保留 Chromium 作为迁移期对照和回滚后端。
- 按 subject-pack、题型、图像质量、`candidateSourceType` 分桶统计误放行率。

### 不直接承诺

- 高风险视觉题无 review 的默认可信放行。
- 作图题答案图全自动主承诺。
- 云 VLM 默认出网。
- 未通过 parity gate 前直接替换 Chromium 主链。

## 4. 分期

### P0：契约与计划落盘

- 自动解题工作站终局计划。
- Typst 主渲染迁移计划。
- renderer contract schema。
- ADR 记录目标变更和当前运行时边界。

### P1：自动解题工作站骨架

- `AnswerGenerationRequest / AnswerGenerationResult`。
- 原题输入归一化入口。
- `ProblemEvidenceBundle / TrackResult / DecisionRecord` 的运行时读写；当前只完成显式视觉探针和离线决策编译，尚未接入默认主答题流程。
- WPF review 队列的最小可用闭环。

### P2：双轨视觉运行时

- Track A / B 接入。
- 图片预处理、局部高清 crop、多尺度裁剪。
- 图号/小问绑定器。
- 高风险 visual-evidence eval 扩展。

### P3：Track C 与策略门禁

- 仪表、坐标图、函数图、几何图、表格、电路/实验装置 validator。
- 双轨一致同错哨兵集。
- `trusted=false` 自动判定与 review 回写。

### P4：Typst 主渲染迁移

- Typst 模板和渲染器 adapter。
- Chromium / Typst parity gate。
- PDF 元数据、可访问性、分页、数学排版和 review 定位验证。
- 回滚到 Chromium 的自动化路径。

### P5：持续评测飞轮

- 高风险误放行率。
- 正确标疑召回率。
- 图号/小问绑定准确率。
- review 后修正回放通过率。
- renderer parity regressions。

## 5. 验收指标

- 高风险视觉误放行率持续下降，且按 subject-pack 单独统计。
- 双轨一致但证据缺失样例保持 `trusted=false`。
- `visualReviewPassed=null` 不被误解释为已通过。
- Typst 与 Chromium parity gate 通过前，当前运行时仍保持 Chromium。
- Typst 升主后，Chromium 回滚后端仍可在失败时恢复交付。

## 6. 参考依据

- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)：视觉能力存在细节、空间定位和准确性限制，必须把证据链与复核做成产品机制。
- [Azure Document Intelligence Layout](https://learn.microsoft.com/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0)：layout 提取文本、表格、选择标记和结构，适合作为 Track B 的设计依据。
- [Typst export and preview](https://typst.app/docs/web-app/export-and-preview/)：Typst 支持导出 PDF、PNG、SVG 和 HTML。
- [Typst PDF reference](https://typst.app/docs/reference/pdf/)：Typst 支持 PDF/UA、PDF/A 等 PDF 标准能力，适合作为主渲染目标的候选依据。
