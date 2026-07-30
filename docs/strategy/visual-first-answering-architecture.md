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
- `DeliveryQuestionCoverage`：把 delivery snapshot/input/manifest bytes 绑定到 `sample-package.expectedQuestionRefs` 题目 inventory。
- `DeliveryDecisionAggregate`：聚合覆盖集合内逐题 DecisionRecord，重算缺题、未决题、门禁和 lifecycle，形成交付级状态投影候选。
- `DeliveryDecisionAggregateAttachmentReceipt`：记录 aggregate 附着的 manifest preimage/result hash、backup 与 aggregate 引用，避免把 result hash 自引用写入 manifest。

### 既有视觉真值对象

- `problem-figure-asset`
- `figure-understanding-result`

`ProblemEvidenceBundle` 只聚合和引用既有对象，不复制、不替代。

当前仓内已具备最小运行时闭环：

- `tools/ai-gateway/vision-request.mjs`：显式 Track A 视觉探针，返回并校验 `TrackResult`。
- `tools/visual-evidence/decision-record.mjs`：读取 `ProblemEvidenceBundle + TrackResult[]`，生成并校验 `DecisionRecord`。
- `tools/track-orchestrator/track-orchestrator.mjs`：从 current raw bytes 准入 Track A/B/C，分别记录 candidate comparison、track degradation、Track C 与全源 blockers，并只调用上述 DecisionRecord compiler；当前 canonical inputs 全部为 public synthetic。
- `tools/visual-page-normalizer/visual_page_normalizer.py`：从一份 VISION-007-derived public synthetic capture 检测 page quadrilateral，执行 perspective/orientation correction 与 median denoise，并输出 hash-bound `NormalizedPage + PNG`；当前 `regionRefs=[]`，不提供自动区域或 OCR/layout authority。
- `tools/visual-evidence/attach-decision.mjs`：校验本地 `DecisionRecord` 与 delivery manifest，把本次写入的直接前像原子刷新到 rollback backup 后，再原子附着 `visualDecisionRef / visualReviewPassed / trusted`；不生成审批、不推进 lifecycle。
- `tools/visual-evidence/delivery-decision-aggregate.mjs`：基于原始 bytes SHA-256、snapshot/input/manifest、sample-package inventory 和逐题 DecisionRecord 编译交付级 aggregate；只生成离线证据，不修改 manifest。
- `tools/visual-evidence/attach-delivery-decision-aggregate.mjs`：重验 aggregate 对应的 manifest preimage，在共享 manifest 写锁内固定全部绑定源的 bytes 快照，写 receipt 与 backup 后、最终替换前再次核对，再原子附着 delivery-level trust；不推进 lifecycle。
- `eval/visual-evidence/`：保存双轨一致但证据链缺失、不安全捷径绕过 grounding 仍 fail-closed 的回归样例。
- WPF 交付入口：一次答案交付后投影 delivery manifest 的 `review.lifecycle / visualDecisionRef / visualReviewPassed / trusted`，允许选择本地 JSON 题目决策或 delivery aggregate 交给上述受控工具附着；aggregate 附着成功后立即 source-aware 重验，只有同批 manifest bytes 匹配 receipt hash 才投影正向时间点状态。

该闭环证明 synthetic `TrackResult[] -> orchestration report + DecisionRecord -> delivery manifest -> WPF refresh` 的各段受控合同路径可以运行，但这些段尚未接成默认工作流，也不等于真实 provider Track A/B/C、生产局部高清/OCR/layout、审批生成/回写或默认主答题流程已经产品化。

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
6. 当前本地 CLI 已能把 aggregate 的覆盖证明连同 preimage/result receipt 受控附着到 manifest；renderer manifest writer 与两个 attach 同时获取 canonical path lock 和 physical identity lock，代码不自动删除 stale lock，并拒绝 manifest 文件自身为 symlink。.NET orchestration 已提供受控附着和显式 source-aware verifier；WPF 可由用户选择已有本地 aggregate，附着成功后立即重验，并只投影与 `manifestResultSha256` 绑定的时间点状态。普通 WPF 读取、headless 和诊断读取面只要 attachment 未经本次重验（包括 malformed 值）仍必须把正向状态钳制为未裁定/未可信。
7. 离线 aggregate 只有在 inventory 非空且唯一、逐题 DecisionRecord 无缺失/额外/重复、无阻断原因、manifest 三门禁通过且 lifecycle 为 `approved/published` 时才可生成 `trusted=true`。CLI attach 不等于 WPF workflow integrated，不能据此宣称真实交付已验收。

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
- `review.deliveryDecisionAggregateAttachment`
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
