# Final Implementation Baseline

## 1. 项目真相与最佳终态

### 项目真相

本仓是一个 Windows-first、本地优先、以 `subject-pack + snapshot + compiled spec + eval` 为核心的 K12 试卷参考答案交付工具链。

当前最成熟的运行主线仍然是：

- 输入：已有答案 Markdown
- 校验：规则与 LaTeX 基线校验
- 输出：PDF、review 页图、delivery manifest

也就是说，当前成熟链路仍是 `answer.md -> PDF/review`。`原题 -> answer.md` 是新增主链，不存在于现有交付链中。

### 最佳终态

最佳终态不是“更大的提示词文档”，而是一个本地工作站产品：

- 桌面应用承载主入口、工作区诊断、review 队列和交付状态
- `subject-pack` 承载学科规则与运行资产
- `snapshot` 承载运行时真相
- `compiled spec` 承载人类可转发真相
- 反馈链、样例飞轮和视觉证据对象形成持续改进闭环

### 第二阶段增强

以下能力属于第二阶段增强，不属于当前主承诺：

- 自动作图答案图
- 高风险视觉题全自动可信放行
- Prompt prose 自动优化
- 本地多 VLM ensemble
- 第二 PDF 后端

## 2. 四项硬约束

1. 不原地破坏 `delivery-manifest.status` 兼容语义。
2. 不新建并列 orchestrator，继续增强现有 `check-toolchain` 与既有交付链。
3. 不把云厂商写死，云侧必须 provider-neutral。
4. 不让自动优化直通生产，所有灰度都必须受门禁和审批边界约束。

## 3. 文档、规范与运行时真值边界

- `prompts/specs/`：人类规范真值区。
- `docs/strategy/`：规划、执行与演进真值区。
- `compiled spec`：对外可转发的人类真相。
- `snapshot`：运行时真相。
- `eval/`：回归与视觉基线真值。

运行时读取 `snapshot`，而不是直接读取大规格 Markdown。

## 4. delivery-manifest 兼容迁移

### 保持不变

保留以下字段及语义：

- `status.toolchainPassed`
- `status.deliveryComplete`
- `status.reviewArtifactReady`
- `status.visualReviewPassed`
- `status.trusted`

其中 `status.visualReviewPassed` 保留 `true | false | null` 三态。

### 新增并列字段

- `review.lifecycle`
- `review.feedbackRefs[]`
- `review.visualDecisionRef`
- `policy.visualPolicyVersion`
- `policy.optimizationVersion`

### 状态机

`review.lifecycle` 固定为：

`draft -> ready_for_review -> under_review -> visually_reviewed | needs_revision -> approved -> published`

### 聚合语义

- `visualReviewPassed=true`：全部题 `accept` 且 review lifecycle 达到通过态。
- `visualReviewPassed=false`：显式人工复核未通过或 `needs_revision`。
- `visualReviewPassed=null`：待复核、自动降级或未裁定。
- `trusted=true`：toolchain 与 delivery 通过、无未决题、review lifecycle 达批准态。

## 5. 题目锚点两阶段

### P0

在 feedback、evidence、decision 等 schema 中预留：

- `questionId?`
- `subQuestionId?`
- `figureId?`
- `normalizedQuestionRef`

### P0-P1

实现 `questionRef -> normalizedQuestionRef` 的规范化器，并逐步生成稳定主键。

### P1

再逐步把稳定主键贯通到：

- `feedback-record`
- `ProblemEvidenceBundle`
- `DecisionRecord`
- `delivery manifest`

P0 不做一次性全链路主键重构。

## 6. 样例真值面 schema 集

### sample-package.schema.json

约束 `样例交付/structured/<subjectPack>/<sampleId>/sample.json`。

固定字段：

- `sampleId`
- `subjectPack`
- `dataClassification`
- `expectedQuestionRefs[]`
- `artifacts[]`

`artifacts[].role` 固定枚举：

- `problem_source`
- `reference_truth`
- `teacher_annotation`
- `legacy_answer`
- `negative_candidate`

每个 artifact 固定字段：

- `artifactId`
- `path`
- `mediaType`
- `sourceType(pdf|scan|image|docx|markdown|json)`
- `parseMode(native|degraded)`

### sample-index.schema.json

约束扁平 `样例交付/index.json`。

P1 的 flat scoring 只能通过该索引入场。

固定字段：

- `sampleId`
- `dataClassification`
- `expectedQuestionRefs[]`
- `problemSource[]`
- `referenceTruth[]`
- `teacherAnnotation[]`
- `candidateRefs[]`

命名约定只保留给 demo 与人工导入，不再作为自动评分真值面。

### negative-candidate.schema.json

固定字段：

- `candidateId`
- `candidateSourceType(reference_placeholder|historical_candidate|generated|perturbed_negative)`
- `artifactRef`
- `expectedPrimaryErrorType`
- `expectedContributingErrorTypes[]`
- `expectedDiffLayer(answer|evidence|format|policy)`
- `originRef`
- `mutationRef`

### sample-run-record.schema.json

固定字段：

- `runMode(plumbing|scoring)`
- `candidateSourceType`
- `truthExtractionStatus(ok|low_confidence|failed)`
- `inputAnswerLeakage(none|detected_and_stripped|suspected_unresolved)`
- `manifestRef`
- `diffSummary`
- `rootCauseSummary`
- `optimizationCandidateRefs[]`
- `stopReason`

## 7. feedback-record 归因模型

`feedback-record` 的权威归因字段为：

- `primaryErrorType`
- `contributingErrorTypes[]`
- `confidence`

兼容字段 `errorType` 只保留为 `primaryErrorType` 的别名，不再作为新模型演进面。

9 类权威值域固定为：

- `spec_gap`
- `rule_gap`
- `routing_error`
- `visual_error`
- `ocr_error`
- `reference_parse_error`
- `reasoning_error`
- `format_error`
- `data_quality_issue`

## 8. 运行控制字段

### runMode

- `plumbing`：只验证流程，不产优化信号，不计入收益指标。
- `scoring`：允许产出 `OptimizationCandidate`，允许进入分桶统计与灰度候选评估。

### candidateSourceType

- `reference_placeholder`
- `historical_candidate`
- `generated`
- `perturbed_negative`

### truthExtractionStatus

- `ok`
- `low_confidence`
- `failed`

### inputAnswerLeakage

- `none`
- `detected_and_stripped`
- `suspected_unresolved`

### scoring 准入三条件

1. `candidateSourceType in {historical_candidate, generated, perturbed_negative}`
2. `truthExtractionStatus = ok`
3. `inputAnswerLeakage != suspected_unresolved`

## 9. 输入归一化与答案泄漏策略

### 输入归一化

- PDF/扫描：P1 主链
- 图片：P1 基本导入，P2 去透视/裁边/旋转
- Word：P1 固定 `degraded-supported`，P2 才引入原生 `docx -> NormalizedPage`

禁止把 `Word -> PDF -> OCR -> 求解` 作为正式求解路径。

### Word 的 P1 语义

P1 对 Word 的处理固定为：

- 保留原 `docx`
- 派生审阅 PDF
- `parseMode=degraded`
- 作为 `L3/degraded truth` 统计

在原生 `docx -> NormalizedPage` 落地前，Word 不计入 L2 成功指标。

### 答案泄漏

P1 样例集默认人工拆分题面/答案：

- 小样本阶段不为 4 份样例构建自动剥离器
- 拆分后的样例反过来作为 P2 自动剥离器的真值资产

若 `inputAnswerLeakage = suspected_unresolved`，样例不得进入 blind scoring。

## 10. 视觉对象与双轨门禁

### 保留既有对象

- `problem-figure-asset`
- `figure-understanding-result`

### 新增聚合层对象

- `NormalizedPage`
- `VisualRegion`
- `ProblemEvidenceBundle`
- `TrackResult`
- `DecisionRecord`

`ProblemEvidenceBundle` 只引用既有视觉 schema 的 id，不复制、不替代。

### Track 定义

- Track A：多模态视觉直答
- Track B：OCR / 图元抽取 / 结构化证据后再求解

### 默认门禁

1. 双轨不一致：必复核
2. 双轨一致但命中高风险视觉题：强制复核或抽检
3. 证据链缺失、低置信、图号绑定不稳：不得自动放行
4. 局部不确定但不阻断整份交付：对应小问标记 `【疑】/待复核`

## 11. 分桶测评与放行门槛

### 指标分桶

所有核心指标必须按 `candidateSourceType` 分桶，至少独立报告：

- `perturbed_negative`
- `historical_candidate`
- `generated`

禁止只报总分。

### 灰度前置门槛

任一 `OptimizationCandidate` 进入灰度前，必须同时满足：

1. `perturbed_negative` 桶判错召回率 `>= 0.80`
2. `historical_candidate` 或 `generated` 至少一桶 `n >= 3` 且判错召回率 `>= 0.70`
3. `check-toolchain` 全链为绿
4. 无 restricted 出网违规
5. 无 leakage 未决样例

`perturbed_negative` 单独达标绝不构成优化放行依据。

## 12. P0-P3 sequence

### P0

- `$id + compatibility`
- `data-classification / sample-package / sample-index / negative-candidate / feedback-record` 等 schema 真值面
- `check-toolchain` 中的新增 schema 校验与 answer eval diff 强化
- 根文档与 strategy 真值面收口

### P1

- 飞轮骨架
- `SampleRunRecord / FeedbackParseResult / OptimizationCandidate / DecisionRecord`
- 样例真值面
- Track A
- WPF review 队列与反馈入口
- 生成主链后段接入

### P2

- Track B
- 图片预处理副链
- Word 原生解析
- 双轨 evidence / review / 灰度优化

### P3

- Prompt prose 优化
- 多 VLM ensemble
- 其他研究性增强

## 13. 三类人工队列

- `needs_human_label`：反馈解析置信不足
- `high_risk_approval`：高风险优化候选审批
- `truth_needs_review`：参考答案抽取不可靠、真值存疑或 leakage 未解决

三类队列必须分开，不能把真值问题误投到模型优化队列。

## 14. 默认假设与不做项

### 默认假设

- 当前最可复用真值起点是 4 份参考答案 Markdown。
- 初中物理仍是当前主线；高中物理与数学暂作平台验证入口。
- 默认本地优先，`egressPolicy.allowCloud=false`。

### 当前不做

- 不在本轮文档阶段改源码、schema、测试或运行时逻辑
- 不新开 ADR
- 不把自动作图答案图重新抬回主承诺
- 不在 P1 承诺 Word 原生解析可交付
