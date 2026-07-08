# Visual-First Answering Architecture

## 1. 核心判断

跨学科、跨学段的最大错误源不是文本推理，而是看图。

视觉题不能被设计成“让模型再认真看一遍”。终局方向是 **视觉证据编译器**：先把原卷 PDF / 图片编译成可追踪、可校验、可回放的证据对象，再让 AI 解题和生成交付。

核心目标不是让模型永不看错，而是把“看错还自信输出”的概率降到最低。

## 2. 证据编译器对象

### 输入归一化

- `NormalizedPage`：统一记录源文件、页号、页图、DPI、像素尺寸、方向检测、deskew、裁边、去噪、多尺度渲染与质量标记。
- `VisualRegion`：统一记录题区、图区、表格区、公式区、坐标轴区、刻度区、图例区、局部 crop 及其坐标。

### 聚合证据

- `ProblemEvidenceBundle`：聚合每个小问的 `questionRef -> figureRef -> cropRef -> evidenceRef` 链，不复制既有视觉对象。
- `TrackResult`：记录 Track A / B / C 的候选答案、证据、冲突、缺失证据、置信度和风险。
- `DecisionRecord`：记录最终是否可放行、是否标疑、是否进入 review 队列，并投影到 `visualReviewPassed` 与 `trusted`。

### 既有视觉真值对象

- `problem-figure-asset`
- `figure-understanding-result`

`ProblemEvidenceBundle` 只聚合和引用既有对象，不复制、不替代。

当前仓内已具备最小运行时闭环：

- `tools/ai-gateway/vision-request.mjs`：显式 Track A 视觉探针，返回并校验 `TrackResult`。
- `tools/visual-evidence/decision-record.mjs`：读取 `ProblemEvidenceBundle + TrackResult[]`，生成并校验 `DecisionRecord`。
- `eval/visual-evidence/`：保存双轨一致但证据链缺失、不安全捷径绕过 grounding 仍 fail-closed 的回归样例。

该闭环证明 `TrackResult -> DecisionRecord` 的合同可以运行，但不等于局部高清 crop、OCR/layout 抽取、WPF review 队列或默认主答题流程已经产品化。

### QQ 重链路可移植映射

`qq-codex-bot` 的重链路经验只作为阶段化 trace 参考，不改变本仓 canonical contract：

- `VisualInputBundle`：`NormalizedPage + VisualRegion + crop/OCR/layout refs` 的请求安全视图，用于控制传给模型的原图、局部 crop、OCR/layout 片段和出网边界。
- `GroundingSnapshot`：解题前的可见事实抽取，记录文字、公式、已知量、待求量、图形关系、子问和不确定项；不能被直接当成最终答案。
- `SolutionSnapshot`：基于 grounding 的逐小问候选答案，必须记录使用的 knowns、diagram relations、单位检查和 unsupported claims。
- `ConsistencyReport`：Track C / validator 的结构化一致性结果，专门拦截 `unsafe_shortcut_fail`、`grounding_insufficient`、答案格式和学科约束问题。

这些阶段产物通过 `TrackResult.stageArtifactRefs` 可选引用，并最终由 `DecisionRecord` 聚合为 `trusted / visualReviewPassed / reviewRequired`。不允许把阶段产物绕过 `DecisionRecord` 直接写成可信交付。

## 3. 三轨定义

### Track A：VLM 直看

- 看原页图和局部高清 crop。
- 对小字、刻度、坐标轴、表格、图例、几何辅助线使用高细节图像输入。
- 输出候选答案、可见证据摘要、证据引用和置信度。

### Track B：OCR / layout / 图元结构化后求解

- 先抽取 OCR 文本、版面、表格、选择标记、图元、坐标和结构化数据。
- 再把文本化或结构化后的问题交给 AI 求解。
- OCR 只辅助；当 OCR 与原图冲突时，以原图 crop 和证据复核为准。

### Track C：规则校验

- 检查单位、量程、分度值、坐标轴、图号绑定、答案格式和学科约束。
- 对仪表读数、坐标图、函数图、几何图、电路图、实验装置图、表格统计口径提供专用 validator。
- Track C 不负责“看懂所有图”，只负责拦截明显违反证据或物理/数学约束的候选。

## 4. fail-closed 门禁

1. AI 解题不能只引用整页图，必须引用局部 crop、OCR / layout 片段、图号绑定和结构化证据。
2. 任一轨道冲突、证据不足、绑定不稳、低置信或 validator 阻断，不能 `trusted=true`。
3. 双轨一致也不能直接可信，因为可能一致同错；必须同时检查证据链、风险分类、置信度和哨兵样例表现。
4. `visualReviewPassed=null` 表示未裁定、自动降级或待复核；`trusted=false` 直到无未决题且 review 生命周期批准。
5. 不允许静默降级到纯文本链后假装已经完成看图。

离线决策编译器必须把以下情况推导为 `review_required`：证据链缺 crop、binding 不稳、Track 结果冲突、Track C blocking finding、高风险视觉题、低置信或 review 生命周期未批准。

新增 `unsafe_shortcut_fail` 作为一等失败原因：模型直接进入计算、选项或最终答案，但没有覆盖题干、可见图形关系、已知量、待求量和不确定项 grounding 时，即使候选答案碰巧正确，也必须保持 `trusted=false`。

## 5. 高风险视觉题

以下题型默认进入高风险通道：

- 刻度/仪表读数题
- 坐标图、函数图、统计图表
- 几何关系与辅助线
- 实验装置图与电路图
- 多图多问绑定题
- 作图题
- 模糊、旋转、倾斜、遮挡、低清晰度、小字密集题图
- 题图与 OCR 冲突、题图与参考答案冲突

高风险题可以自动生成候选答案，但默认输出 `/待复核` 或对应小问 `【疑】`；只有证据链完整、风险策略允许且 review 生命周期批准后，才允许进入可信交付。

## 6. review 回写

视觉链必须能把结果回写为：

- `DecisionRecord`
- `review.visualDecisionRef`
- `review.feedbackRefs[]`

WPF review 队列需要展示：

- 原页图
- 局部 crop
- OCR / layout 片段
- Track A / B / C 候选
- 冲突点、缺失证据和疑点原因
- 教师批准、退回或修正结果

## 7. 持续评测飞轮

核心指标不是总正确率，而是：

- 高风险误放行率
- 正确标疑召回率
- 图号/小问绑定准确率
- OCR 与原图冲突发现率
- review 后修正回放通过率
- 按 `subject-pack`、题型、图像质量、`candidateSourceType` 分桶统计
- 按 `repo_supported / gateway_verified / workstation_accepted` 分层统计，不把网关探针通过误报成工作站闭环验收

必须保留“看图错误难例库”，覆盖小字刻度、坐标轴交点、函数趋势、几何辅助线、表格统计口径、电路连接、实验装置、多图多问、模糊、旋转、遮挡、低分辨率、OCR 错、VLM 错、双轨一致但证据缺失等样例。

## 8. 渲染链边界

视觉证据编译与解题可信度不依赖“先换渲染引擎”。当前主链仍是 Playwright / Chromium PDF review。Typst 是终局主渲染目标，但只有在分页稳定性、数学排版、review 证据定位、可访问性、导出一致性和工具链维护成本全部通过 parity gate 后，才允许替换当前运行时。

## 9. 参考依据

- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)：视觉能力存在小字、旋转、图表样式、空间定位和准确性限制；细节敏感场景应选择更高图像细节。
- [Azure Document Intelligence Layout](https://learn.microsoft.com/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0)：layout 模型强调提取文本、表格、选择标记、结构和页面元素。
- [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF)、[RapidOCR](https://github.com/RapidAI/RapidOCR)、[LayoutParser](https://github.com/Layout-Parser/layout-parser)、[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)：社区成熟方向是 OCR、版面、结构、图像证据分层处理，而不是只靠单个视觉模型直答。

## 10. 与其他文档的边界

- 产品目标与范围：见 [product-prd.md](./product-prd.md)
- 权威实施规格：见 [final-implementation-baseline.md](./final-implementation-baseline.md)
- 规范治理：见 [spec-evolution-adaptation-plan.md](./spec-evolution-adaptation-plan.md)
