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
- 自动解题工作站承载 `原题 -> 证据 -> 候选答案 -> 风险决策 -> review -> 可信交付`
- Typst 成为终局主渲染目标，Playwright / Chromium 在迁移期保持当前运行时和 fallback

### 第二阶段增强

以下能力属于第二阶段增强，不属于当前主承诺：

- 自动作图答案图
- 高风险视觉题全自动可信放行
- Prompt prose 自动优化
- 本地多 VLM ensemble
- Typst 运行时替换；目标已接受，但必须先通过 renderer contract 和 parity gate

## 2. 五项硬约束

1. 不原地破坏 `delivery-manifest.status` 兼容语义。
2. 不新建并列 orchestrator，继续增强现有 `check-toolchain` 与既有交付链。
3. 不把云厂商写死，云侧必须 provider-neutral。
4. 不让自动优化直通生产，所有灰度都必须受门禁和审批边界约束。
5. 不在 Typst adapter、parity gate 和 rollback smoke 完成前替换 Playwright / Chromium 默认运行时。

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

- `sampleIndexSha256`
- `samplePackageSha256`
- `candidateDescriptorRef`
- `candidateDescriptorSha256`
- `runMode(plumbing|scoring)`
- `candidateSourceType`
- `truthExtractionStatus(ok|low_confidence|failed)`
- `inputAnswerLeakage(none|detected_and_stripped|suspected_unresolved)`
- `manifestRef`
- `diffSummary`
- `rootCauseSummary`
- `optimizationCandidateRefs[]`
- `stopReason`

当前首个合成飞轮切片以 `样例交付/index.json` 为不可覆盖的 canonical authority，通过
`subjectPack / packageRef / packageSha256` 唯一绑定
`structured/<subjectPack>/<sampleId>/sample.json`。index、package 与 candidate 内部引用经
realpath 后必须留在对应 root；`candidateBindings` 另外绑定 descriptor path/hash，
`.gitattributes` 固定 hash-bound 样例资产为 LF；所有 run 必须显式提供 truth extraction
与 leakage 状态。仓内通用 validator 只提供有限 shape 检查，compiler semantic invariants
另外负责正整数、SHA-256、diff/hash/root-cause/stopReason 一致性、plumbing 无评分信号、
scoring admission 与当前无 optimization refs 等语义约束，并重验 current canonical
authority bytes。任意归档 authority 验真不属于当前能力。

### VISION-004 synthetic visual-risk diagnostics

VISION-004 在既有 `ProblemEvidenceBundle -> TrackResult[] -> DecisionRecord` spine 上新增独立
`VisualRiskCaseInventory / VisualRiskDiagnosticReport`。canonical authority 固定为 6 个完全合成、
脱敏且禁云的 cases，`math-answer / junior-physics-answer / senior-physics-answer` 各 2 个；每个
subject-pack 至少覆盖一个 stable binding 和一个 ambiguous binding 或 OCR/image conflict/validator
block。inventory 必须逐项绑定 evidence bundle、全部 track results 和 expected decision 原始 bytes
SHA-256，引用经 realpath 后不得逃逸 canonical fixture root，且目录内 authority 必须被精确覆盖。

diagnostic compiler 先验证 inventory 与全部输入 schema/hash/path/coverage，再用当前
DecisionRecord compiler 逐项重放，以 two-space JSON + trailing LF 与 expected decision raw bytes
比较。合法但不一致的 replay 计为失败；authority 损坏则整体 fail closed。报告按 subject-pack
分别统计 `falseReleaseRate = falseReleaseCount / expectedReviewCount`、
`correctFlagRecall = correctlyFlaggedCount / expectedReviewCount`、
`bindingAccuracy = bindingCorrectCount / totalCases` 和
`replayPassRate = replayPassedCount / totalCases`，不得只报告跨学科总值。

该指标只证明冻结 synthetic fixture 上的 repo-side contract diagnostics，不代表真实图像质量、
OCR/VLM 准确率、gateway live verified、workflow integrated 或 live accepted。报告必须保持
`optimizationCandidateRefs=[]`、readiness controls 的 `toolchain/restrictedEgress=not_verified` 与
`eligible=false`；不消费真实试卷，不接 WPF，不开启 cloud egress，不生成
`OptimizationCandidate`。CLI 重编译输出必须位于仓库根目录之外，不能覆盖或 alias 任一
canonical authority。

## 7. feedback-record 归因模型

`feedback-record` 的权威归因字段为：

- `primaryErrorType`
- `contributingErrorTypes[]`
- `confidence`

兼容字段 `errorType` 只保留为 `primaryErrorType` 的别名，不再作为新模型演进面。

### feedback-parse-result.schema.json

首个可执行反馈归因切片只接受 current-authority-valid、`exactMatch=false` 且
`labelSource=negative_candidate_fixture` 的 scoring `SampleRunRecord`。结果必须绑定 source
run 原始 bytes SHA-256、index/package/descriptor authority hashes，并只生成一个
`source=auto_collected` 的 `feedback-record`。severity 与 confidence 来自 hash-bound
negative-candidate fixture 标注；`createdAt` 由调用者显式提供 canonical UTC timestamp。
`optimizationCandidateRefs` 必须为空，`stopReason=feedback_recorded_no_optimizer`。

`negative-candidate.schema.json` 保持 additive base contract，新增 severity/confidence 属性不对
所有历史 descriptor 设为 schema required；进入 canonical FLYWHEEL-004 authority 的 descriptor
由 assets/compiler semantic admission 强制要求这两个字段、合法值域、唯一 contributing errors
且 contributing 不得重复 primary。

该切片不解析教师自由文本，不做语义答案评分，不验证任意归档 authority，不生成
`OptimizationCandidate`，也不构成灰度放行。

FLYWHEEL-008 将 `FeedbackParseResult` 升级为 `2.0`，并新增独立
`TeacherFeedbackSubmission` 输入合同。首个 teacher-text parser 只接受仓内 hash-bound canonical
fixture inventory 准入的公开 `synthetic_fixture`，以 current-authority-valid scoring run 和
submission/result 原始 bytes SHA-256 绑定。它只识别 9 类根因与 4 档 severity 的显式短语
词典，不声称开放域语义理解：唯一非否定根因且唯一 severity 才生成一个
`source=teacher_input` record；缺失、歧义或显式否定信号输出
`parseDisposition=needs_human_label`、空 records、`humanQueue=needs_human_label` 和稳定 reason
code。v2 schema 以互斥 shape 阻断不可能字段组合；两类结果的
`optimizationCandidateRefs` 都必须为空。

teacher parse result 当前不进入 readiness 判错统计；既有 auto-collected fixture 迁移到 v2
后继续沿原路径统计。真实教师反馈、restricted 数据、自由文本模型解析、WPF 入口与
`OptimizationCandidate` 均不属于该切片。v1 feedback result 不静默兼容，必须从绑定的
current run/input 重新编译。

FLYWHEEL-009 新增独立 `TeacherFeedbackDiagnosticReport`，只对 FLYWHEEL-008 的
hash-bound canonical synthetic fixture inventory 做 ingestion diagnostics。报告逐项绑定 result
raw-byte SHA-256，确定性统计 `parsed / needs_human_label` 数量与比率，并按固定 9 类根因、
4 档 severity、5 类人工分流 reason code 输出完整分布。零计数类别也必须保留，避免消费者
把“当前未观测”误解为“合同不存在”。

该报告不是 `OptimizationReadinessReport` 的子面，也不进入 candidateSourceType 分桶、判错
recall、release qualification、controls 或 eligibility。它的 structured rate 只证明当前受控
synthetic fixture 的 parser 分流覆盖，不代表真实教师语言理解准确率、模型质量或生产验收；
`optimizationCandidateRefs` 必须为空。
CLI 重编译输出必须位于仓库根目录之外；任何仓内 readiness、generated、teacher 或其他
canonical asset 都不得作为输出目标，拒绝时必须保持原始 bytes 不变。

FLYWHEEL-010 新增独立 `TeacherFeedbackReplayDiagnosticReport`，对同一 canonical inventory
逐 fixture 重新执行当前确定性 parser，将 replayed result 以稳定 JSON bytes 序列化，并与
inventory hash-bound expected `FeedbackParseResult` 原始 bytes 比较。报告逐项绑定 submission、
expected result 与 replayed result 的 SHA-256，统计 `passed / failed / passRate`；expected
authority 的 schema、hash、路径或覆盖面损坏仍必须整体 fail closed，只有合法 expected bytes
与合法 replayed bytes 不一致才记为 replay failure。

replay report 与 ingestion diagnostic、candidate readiness 分离。它只证明当前 parser 对三个
受控 synthetic fixture 的确定性回放兼容，不代表真实教师语言理解、语义正确性、模型质量或
生产验收；`optimizationCandidateRefs` 必须为空，CLI 输出必须位于仓库根目录之外。该切片
不得修改 FLYWHEEL-009 ingestion report、readiness、release qualification、controls 或
eligibility。

### optimization-readiness-input / optimization-readiness-report

首个分桶准入评估切片由独立、hash-bound canonical case inventory 提供召回率分母，
不能从已产生的 `SampleRunRecord` 或 `FeedbackParseResult` 反推分母。inventory case
绑定 current canonical candidate descriptor path/hash，并按 `sampleId + descriptor hash`
去重；runtime manifest 必须一一覆盖 inventory，可选绑定 current-authority-valid scoring
`SampleRunRecord` 与同一 run 的 `FeedbackParseResult` 原始 bytes SHA-256。缺少 run 或
feedback 的 expected-error case 仍保留在分母，不能通过改 `caseId/iteration` 重复计数。

报告固定输出 `perturbed_negative / historical_candidate / generated` 三桶及各桶原始 `n`、
expected/detected error count、recall availability 和可用时的 recall；同时输出由 canonical
`ReleaseQualification` 过滤后的 `qualifiedN`、qualified expected/detected error count、
qualified recall availability 和可用时的 qualified recall。原始指标用于诊断，非扰动
eligibility 只能读取 qualified 指标。报告同时投影
`toolchainStatus / restrictedEgressStatus / unresolvedLeakageCount`，并从 inventory 独立
投影 truth/leakage 未决和 missing run，按第 11 节门槛计算稳定 reason codes；任一条件
不足时 `eligible=false`。两项 control 当前只能是 `not_verified`。仓外运行目录中的
`ReadinessControlReceipt` 是 pre-attestation 诊断面：runner 必须从 clean HEAD 开始，按
固定顺序执行 build/test/assets/cross-subject/toolchain/gateway-config，强制 cloud egress
disabled，保存逐 gate log/hash，并在结束后重验 HEAD 与 clean worktree 未漂移。readiness
重验 receipt 原始 bytes、完整有序 gate、log bytes 与当前 clean revision后，只投影
`receiptStatus=unattested_local_record`，不得据此把 toolchain 或 restricted-egress control
提升为正向，也不得移除 eligibility blocker。

receipt 的字段和日志可被本地 writer 重建，不具 runner provenance，不是签名 attestation；
强制 false 只关闭本仓 gateway cloud opt-in，不观测或阻断子进程的其他网络活动。因此它
不证明 restricted egress 无违规，不运行 live probes，也不构成 gateway verified、
workflow integrated 或 live accepted。正向 control 必须等待可信 CI 签名、受保护密钥
attestation 或等价 authority。

该报告的 `optimizationCandidateRefs` 必须为空；它只证明 fail-closed readiness 计算与
证据绑定，不生成 `OptimizationCandidate`，不授权灰度，不构成 WPF workflow integration
或 live acceptance。

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

### 首个可执行飞轮增量

- flat scoring 只能通过 `样例交付/index.json` 选择候选；index 与 structured package 的 classification、question inventory、problem/truth/annotation 引用必须一致。
- `plumbing` 可在 truth/leakage 尚未满足 scoring 时验证流程，但不得生成 diff、根因或 optimization refs。
- 首个合成 scoring 只比较 candidate/reference 原始 bytes 的 SHA-256，并使用 `negative-candidate` 的预标注根因记账；它不代表语义答案评分。
- 在 `OptimizationCandidate` 运行时落地前，`SampleRunRecord`、`FeedbackParseResult` 和 `OptimizationReadinessReport` 的 `optimizationCandidateRefs` 必须为空；readiness report 即使指标可用也不能据此直接进入灰度。

### 答案生成合同与 GEN-003 边界

- `AnswerGenerationRequest / AnswerGenerationResult` 是 provider-neutral 生成合同，位于 `ClassroomToolkit.Domain.Generation` 和 `prompts/shared/schemas/`；不得复用或嵌入 `AnswerDeliveryRequest` 的 PDF/profile/review 字段。
- 首个 generator 只允许仓内三个完全合成的 `synthetic_fixture`，输出必须固定 `liveProvider=false`，不得把确定性模板描述为真实模型输出或 historical sample。
- generation request、result、candidate 原始 UTF-8 bytes、generated descriptor、sample package 与 flat index 逐层以 SHA-256 绑定；路径 containment、schema、deterministic recompile 或任一 hash 漂移都 fail closed。
- generated 候选仍需满足 scoring 的 truth/leakage 条件，并沿既有 `SampleRunRecord -> FeedbackParseResult -> OptimizationReadinessReport` 进入独立桶。
- scoring run 必须携带从 current canonical authority 派生的 `ReleaseQualification`：perturbed negative 为 `not_applicable`；当前 deterministic `synthetic_fixture` 为绑定 generation result raw-byte SHA-256 与 provider provenance 的 `diagnostic_only`；缺少可信 qualification evidence 的 historical/future provider 输出为 `unverified`。
- inventory、run 与 readiness report 必须逐层携带并重验同一 qualification；caller 自报、静态 report 字段或 unattested local receipt 都不能产生 `qualified`。当前仓内编译器不产生 `qualified` 状态。
- `SampleRunRecord`、readiness case inventory 与 readiness report 因新增 required qualification/qualified 指标升级为 `2.0`；v1 artifact 不做静默兼容，必须从 current canonical authority 重新编译。`qualified` 虽由共享 schema 为未来受权 writer 保留，当前 runtime validator 仍 fail closed 拒绝该状态。
- GEN-003 即使 generated 桶 `n >= 3` 且 recall 达标，也必须保持 `toolchainStatus=not_verified`、`restrictedEgressStatus=not_verified`、`eligible=false` 和所有 `optimizationCandidateRefs=[]`。
- 本切片不接 WPF，不开启 cloud egress，不消费真实试卷，不运行 live provider，不宣称 workflow integrated、live gateway verified 或 live accepted。

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
- `DeliveryQuestionCoverage`
- `DeliveryDecisionAggregate`

`ProblemEvidenceBundle` 只引用既有视觉 schema 的 id，不复制、不替代。

### 交付级聚合绑定

- `deliveryBinding` 固定绑定 `snapshotId / snapshotSha256 / inputSha256 / manifestSha256`，哈希基于同一次读取的原始 bytes。
- `DeliveryQuestionCoverage.expectedQuestionRefs` 必须与 schema-valid `sample-package.expectedQuestionRefs` 完全一致，不允许从答案 Markdown 猜题号。
- `DeliveryDecisionAggregate` 必须对 expected refs、逐题 DecisionRecord refs 和缺失/额外/重复项重新计数。
- 正向 `trusted=true` 只表示对已绑定 inventory 的完整覆盖；在真实原题 inventory 生成和 review 回写接入前，不等于 workflow integrated 或 live accepted。

### Aggregate 附着 receipt

- `DeliveryDecisionAggregate` 只能附着到其 `deliveryBinding.manifestSha256` 与当前 manifest 原始 bytes 完全一致的 preimage。
- delivery manifest writer、`attach:decision` 与 `attach:aggregate` 必须同时获取 canonical path lock 和基于 `stat.dev/stat.ino` 的 physical identity lock；aggregate 附着在最终替换 manifest 前再次核对 manifest、aggregate、coverage、DecisionRecord、snapshot、input 和 inventory 的稳定 bytes 快照。
- 写锁记录本机 PID、hostname、acquiredAt、canonical manifest path、physical identity 与随机 token；代码不得自动删除既有锁。stale/malformed/remote-owner 锁必须保留原 bytes，经人工确认 owner 已死亡、没有 writer 活动并保存审计副本后才能清理。
- delivery manifest 文件自身不得是 symlink（包括 dangling symlink）；writer 必须 fail-closed。父目录别名由 canonical parent 归一，既有 hardlink 文件由 physical identity lock 串行化。
- 附着工具在写入前原子保存 `<manifest>.before-delivery-decision-aggregate.json`，并将 aggregate ref/hash、preimage hash、backup ref 与 receipt ref 写入 `review.deliveryDecisionAggregateAttachment`。
- `manifestResultSha256` 只记录在独立 receipt，避免 manifest 内的自引用哈希；verify 必须从当前 manifest、receipt、backup 和 aggregate 重算并交叉检查 hash chain。
- aggregate 回滚不是无条件文件覆盖：先保全当前 manifest/receipt/backup，重验 receipt/hash chain，确认当前 manifest SHA-256 仍等于 receipt `manifestResultSha256`，再通过同一 canonical/physical 双锁原子恢复 preimage。当前 hash 不匹配或锁归属不明时必须转人工 reconciliation，禁止覆盖后续合法 writer 更新。
- 附着不推进 `review.lifecycle`，不生成审批；.NET orchestration 提供受控 aggregate 附着和显式、只读、强类型的 source-aware verifier。WPF 可由用户选择已有本地 aggregate，附着成功后必须立即重验，并仅在同批 manifest bytes 的 SHA-256 匹配 receipt `manifestResultSha256` 时投影正向时间点状态。普通 WPF 读取、diagnostics/headless 和未重验 attachment（包括 malformed 值）仍必须投影为 `visualReviewPassed=null / trusted=false`；旧验证结果不得跨 manifest bytes 复用。

### 证据链

每个视觉相关小问必须能追踪到：

`questionRef -> figureRef -> cropRef -> evidenceRef`

其中：

- `NormalizedPage` 记录页图、页号、DPI、预处理和质量标记。
- `VisualRegion` 记录题区、图区、表格区、公式区、坐标轴区、刻度区、图例区和局部 crop 坐标。
- `ProblemEvidenceBundle` 聚合题目、小问、图号、局部 crop、OCR、layout、图元和风险分类。

### VISION-007 本地预处理边界

- `VisualPreprocessingRequest / VisualPreprocessingResult` 是 provider-neutral 预处理合同，不复用 OCR、答案生成或交付请求。
- 首个 runtime 只接受 canonical inventory 准入的 `synthetic_fixture/public` bitmap、显式 integer `page_pixel` bbox、固定 scales `[1,2]` 和 `allowCloud=false`。
- source/request/result/output 必须绑定 raw-byte SHA-256；source 与 crop 另外绑定 decoded RGB pixel SHA-256，输出记录 dimensions、scale、interpolation 与 OpenCV/Pillow engine provenance。
- 1x crop 保持源像素，2x 使用固定插值；输出仅允许写入仓外新目录并原子替换。path containment、physical alias、hash、bbox、scale 或 computed-field 漂移均 fail closed。
- 三个 subject-pack 各一份公开、脱敏 synthetic bitmap，只证明 repo-side preprocessing contract。当前不做 OCR/layout 语义、自动 region 检测、deskew/denoise 推断、Track A/B/C 求解、WPF/gateway/trust/readiness/optimizer 集成。
- 不消费真实试卷/教师/学生数据，不开启 cloud egress，不生成 `OptimizationCandidate`；`ReadinessControlReceipt=unattested_local_record`、controls=`not_verified`、`eligible=false`，workflow 未集成且 live 未验收。

### VISION-008 本地结构抽取边界

- `VisualStructureExtractionRequest / Result` 与 preprocessing、OCR、答案生成和 TrackResult 合同分离，只接受 committed VISION-007 inventory/result 准入的 2x crop。
- `LineSegmentCandidate / ConnectedRegionCandidate / TextRegionCandidate` 只表达固定像素算法输出；不得命名为 axis、tick、wire、component、character 或题目/图号绑定。
- result 必须绑定 preprocessing result/request/crop raw bytes 与 crop decoded RGB pixel hash，记录冻结 algorithm parameters、candidate ordering/counts 与 OpenCV/Pillow provenance。
- `TextRegionCandidate` 只表示固定 bbox/area heuristic，必须保留 `heuristicOnly=true`，不允许 `recognizedText`。
- disposition 固定为 `ocr=not_attempted / semantic=not_inferred / track=not_integrated`。本切片不生成 `FigureUnderstandingResult / ProblemEvidenceBundle / TrackResult / DecisionRecord`。
- 只消费三个公开 synthetic 2x crops；不接 WPF/gateway/readiness/trust/optimizer，不开启 cloud egress，不生成 `OptimizationCandidate`。receipt/controls/eligibility 与 workflow/live 边界保持不变。

### VISION-009 本地 OCR observation 边界

- `VisualOcrObservationRequest / Result` 与 preprocessing、structure extraction、答案生成、delivery 和 TrackResult 合同分离，只接受 committed VISION-007 scale=2 crop，并绑定 same-case VISION-008 result 作为 sibling evidence。
- runtime 固定 RapidOCR/ONNX Runtime/OpenCV/Pillow/NumPy 版本、detector/classifier/recognizer 的 CPU execution provider、三份 bundled ONNX model raw-byte SHA-256 和 whole-crop invocation parameters；版本、provider、模型、配置或 input authority 漂移均 fail closed。
- observation 可为空，也可保留明显错误的模型原始文本与 confidence；confidence 不是 correctness，fixture 没有 ground truth，不计算准确率、召回率或 OCR/image conflict。
- result 固定 `groundTruthAvailable=false / acceptanceDisposition=not_evaluated / requiresHumanReview=true / semanticDisposition=not_inferred / trackDisposition=not_integrated`，local-only provenance 不得升级为 cloud/live。
- 本切片不生成 layout relation、FigureUnderstandingResult、ProblemEvidenceBundle、TrackResult 或 DecisionRecord，不接 WPF/gateway/readiness/trust/optimizer，不使用真实数据，不生成 `OptimizationCandidate`。receipt/controls/eligibility 与 workflow/live 边界保持不变。

### VISION-010 本地空间 observation 边界

- `VisualSpatialObservationRequest / Result` 与 structure extraction、OCR、答案生成、delivery 和 TrackResult 合同分离，只接受 committed VISION-008 result 与 same-case VISION-009 result，并要求两者的 2x crop authority 完全一致。
- runtime 只穷举 `TextRegionCandidate bbox x OCR observation quad`，把 quad 转成 axis-aligned bounds 后记录交面积、双方覆盖率、中心距平方和 geometry-only relation；固定排序、舍入和 stable JSON bytes。
- runtime 不选择最佳匹配、不复制 observed text、不使用 fixture knowledge 或距离阈值，不把 pairwise measurement 命名为字符、标签、题号、axis/tick/wire/component 或 subject semantics。
- result 固定 `associationDisposition=not_decided / layoutDisposition=not_inferred / semanticDisposition=not_inferred / trackDisposition=not_integrated / requiresHumanReview=true`；零测量和 `disjoint` 都是合法诊断输出，不代表图中无文本或已拒绝关联。
- 本切片不生成 FigureUnderstandingResult、ProblemEvidenceBundle、TrackResult 或 DecisionRecord，不接 WPF/gateway/readiness/trust/optimizer，不使用真实数据，不生成 `OptimizationCandidate`。receipt/controls/eligibility 与 workflow/live 边界保持不变。

### VISION-011 generator-declared synthetic OCR diagnostic 边界

- `VisualSyntheticTextTruth / VisualOcrDiagnosticCaseInventory / VisualOcrDiagnosticReport` 与 VISION-009 observation、layout、FigureUnderstanding、TrackResult 和 OCR acceptance 合同分离，只接受 VISION-007 renderer 源码显式声明并由 committed source/crop bytes 绑定的公开 synthetic text/bbox truth。
- truth label 固定区分 `fully_visible / partially_clipped / outside_crop`；只有 `fully_visible` label 进入召回分母。exact case-sensitive text 且 OCR quad axis-aligned bounds 与 truth bbox 正面积相交才形成 diagnostic match；partial label 只允许产生 unscored observation，不贡献召回或正向准确性。
- report 按 subject-pack 独立记录 scorable truth、detected truth、false negative、observation、matched observation、unscored observation、false positive，以及带 availability 的 precision/recall；零分母必须显式 unavailable，禁止伪造 0 或 1。
- result 固定 `diagnosticScope=generator_declared_synthetic_fixture / acceptanceDisposition=not_accepted / requiresHumanReview=true / layoutDisposition=not_inferred / semanticDisposition=not_inferred / trackDisposition=not_integrated`，并保持 local deterministic、禁云 provenance。
- VISION-015 追加第四份 public synthetic fixture 后，前三份既有诊断结果保持，新增 fixture 形成一份 exact-text 正向诊断；这只证明 committed synthetic fixture 的 source-declared OCR diagnostics，不构成人工 ground truth、真实 OCR benchmark、OCR acceptance、layout semantics、FigureUnderstanding 或 Track B。receipt/controls/eligibility 与 workflow/live 边界保持不变。

### VISION-012 generator-declared synthetic text-region diagnostic 边界

- `VisualTextRegionDiagnosticCaseInventory / VisualTextRegionDiagnosticReport` 与 OCR observation、spatial association、layout、FigureUnderstanding、TrackResult 和 acceptance 合同分离，只消费 canonical VISION-008 structure result 与 VISION-011 generator-declared synthetic truth。
- 只有 `fully_visible` truth label 进入召回分母；candidate bbox 与其 crop intersection bbox 正面积相交才形成 diagnostic match。candidate 只命中 `partially_clipped` truth 时记为 unscored；`outside_crop` truth 不保护 candidate。一个 candidate 命中多个 fully-visible truth，或一个 fully-visible truth 命中多个 candidates，必须 fail closed。
- report 按 subject-pack 独立记录 scorable/detected truth、candidate/matched/unscored/false-positive candidate，以及带 availability 的 precision/recall；零分母显式 unavailable。报告不得复制 truth text，也不得从 candidate 推断 recognized text。
- result 固定 `diagnosticScope=generator_declared_synthetic_fixture / candidateKind=text_region_candidate / acceptanceDisposition=not_accepted / requiresHumanReview=true / ocrDisposition=not_inferred / associationDisposition=not_decided / layoutDisposition=not_inferred / semanticDisposition=not_inferred / trackDisposition=not_integrated`，并保持 local deterministic、禁云 provenance。
- VISION-015 追加第四份 public synthetic fixture 后，前三份既有结果保持，新增 fixture 形成一份唯一正向 coverage；这只证明 committed synthetic fixture 的 heuristic text-region spatial proposal diagnostics，不构成人工 ground truth、真实 region benchmark、文字识别、layout semantics、FigureUnderstanding 或 Track B。receipt/controls/eligibility 与 workflow/live 边界保持不变。

### VISION-013 machine-equivalent synthetic visual review 边界

- `VisualMachineReviewReceipt / CaseInventory / Report` 与 delivery review state、`humanApproved`、DecisionRecord、WPF 和 live acceptance 合同分离，只消费 VISION-007 committed preprocessing result 与相同 canonical scale=2 crop。
- reviewer 身份固定为 `reviewerKind=ai_agent / humanReviewed=false / attestationClass=unattested_local_machine_review`；等效政策固定为 `synthetic_fixture_equivalent`，且仅在 `acceptanceScope=synthetic_fixture_diagnostic` 内替代人工视觉检查。任何把它投影为真人身份、签名或 `humanApproved` 的行为均为合同错误。
- 每份 receipt 完整记录 primary-content visibility、required-label legibility、geometry integrity、crop-boundary disclosure 与 known limitations；已知 clipping 不得被静默折叠为无条件 clean pass。report 按 subject-pack 独立统计 accepted/rejected/limited、machine/human reviewed counts。
- report compiler 只重验 upstream/receipt raw bytes、decoded RGB pixel hash、dimensions、coverage、policy 和 computed fields，不声称能确定性重演 AI 视觉判断；runtime output 仍需在 promotion 前重验全部快照。
- VISION-015 追加第四份 public synthetic fixture 后，四份 crop 均由当前 AI 视觉审查并可在该诊断范围内等效替代人工检查；不构成人工身份、真实视觉 benchmark、真实数据验收、OCR/layout/Track B correctness、delivery trust、WPF workflow 或 live acceptance，不生成 `OptimizationCandidate`。receipt/controls/eligibility 保持不变。

### VISION-014 OCR-region association diagnostic 边界

- `VisualOcrRegionAssociationRequest / Result / CaseInventory / Report` 与 OCR correctness、layout、FigureUnderstanding、TrackResult 和 acceptance 合同分离，只消费 same-case canonical VISION-008 structure、VISION-009 OCR 和 VISION-010 spatial result。
- eligible edge 只能来自正交面积大于零且 relation 非 `disjoint` 的 VISION-010 measurement；只有 observation 与 candidate 双向唯一时才形成 association。任一端出现多个 eligible edge 都是 ambiguity，必须 fail closed，不能以距离或 confidence 猜选。
- 零 candidate 或零 observation 的 case 固定 `unavailable`；双方非空但没有 eligible edge 固定 `unmatched`。所有零分母比率显式 unavailable，report 按 subject-pack 独立统计 matched/unmatched/ambiguous/unavailable。
- VISION-014 risk-first probe 证明原三份 frozen authority 没有正向 canonical association：math/senior OCR observation 为空，junior instrument 唯一 pair 为 disjoint。VISION-015 保留这些结果并追加一份独立准入的 public synthetic fixture；该 fixture 只有一组 positive-area 且双向唯一的 endpoint，因此 canonical report 为两例 unavailable、一例 unmatched、一例 matched。
- result/report 不复制 OCR text 或 generator truth，不推断 recognized text、layout relation、题号/图号或学科语义，固定 `acceptanceDisposition=not_accepted / requiresHumanReview=true / layoutDisposition=not_inferred / semanticDisposition=not_inferred / trackDisposition=not_integrated`。
- 本切片只证明冻结 synthetic fixture 上的 association policy plumbing；不构成 OCR correctness、真实 association benchmark、FigureUnderstanding、Track B、delivery trust、WPF workflow 或 live acceptance，不使用真实数据，不生成 `OptimizationCandidate`。receipt/controls/eligibility 与 gateway/workflow/live 边界保持不变。

### VISION-015 positive synthetic association 边界

- 新增 `junior-readable-measurement` public synthetic fixture，通过既有 VISION-007 至 VISION-014 authority chain 产生唯一 OCR observation、唯一 eligible text-region candidate、一份 positive-area spatial measurement 和一份双向唯一 association；不增加 case-specific extractor 或 association policy 分支。
- source/crop 与 VISION-007/008/009/010/014 原三例 case request/result 保持 byte-identical；VISION-011 原三份 truth 因绑定当前 renderer 源文件 SHA-256 而合法重签，inventory/report 随第四例覆盖面更新。该 renderer-bound 重签不能被描述为前三例所有 bytes 不变。
- canonical aggregate 当前包含两例 unavailable、一例 unmatched、一例 matched；两份 OCR observations 中一份形成 association，association rate 为 `0.5`。这些是 fixture coverage 指标，不是现实数据上的 precision、recall 或质量结论。
- 本切片不生成 layout relation、学科语义、`FigureUnderstandingResult`、Track B、delivery trust、WPF workflow 或 live acceptance；不启 cloud egress、不修改 `.env`、不使用真实数据、不生成 `OptimizationCandidate`。`ReadinessControlReceipt=unattested_local_record`、controls=`not_verified`、`eligible=false` 保持不变。

### VISION-016 explicit semantic-role projection 边界

- `VisualSyntheticSemanticDeclaration` 是与 renderer、OCR、geometry 和 association 分离的角色真源；首版只准入 `junior-readable-measurement / truth-label-001 / measurement_reading`，不包含数值、单位、答案、置信度、正确性或 layout 字段。
- `VisualSemanticProjectionRequest / Result / CaseInventory / Report` 只消费同一 case 的 declaration、VISION-011 OCR diagnostic report、VISION-012 text-region diagnostic report、VISION-014 association result、VISION-009 OCR result 与 canonical scale-2 crop，并对路径、physical identity、raw-byte hash、crop hash/dimensions 和快照稳定性 fail closed。
- 投影要求唯一 evidence triangle：`truth-label-001 -> ocr-observation-001` 必须为 `exact_text_positive_overlap`，同一 truth 到 `text-region-001` 必须为 `positive_overlap`，`ocr-region-association-001` 必须连接这两个 endpoint。角色只取 declaration，recognized text 只取绑定 OCR observation；不得从 truth text、文件名、confidence、geometry 或 subject rules 推断。
- 当前 canonical result 只输出一份 `measurement_reading` projection 和 recognized text `12`。它不生成 `FigureUnderstandingResult / ProblemEvidenceBundle / TrackResult / answer candidate`，不解释数值或单位，不构成 layout semantics、question binding、solver correctness 或真实数据质量。
- result/report 固定 not accepted、requires human review、layout not inferred、figure understanding not generated、Track/WPF not integrated、delivery trust not projected、live not accepted、controls not verified、`eligible=false`、`optimizationCandidateRefs=[]`；cloud egress disabled，`.env` 不变，`ReadinessControlReceipt=unattested_local_record` 保持不变。

### VISION-017 synthetic OCR layout solver 边界

- `VisualSyntheticQuestion` 与 VISION-016 projection 独立：题目 authority 明示 question identity、crop、`quantityKind=length`、`semanticRoleRequired=measurement_reading` 与 prompt 中实际出现的 `centimetres / cm`，但不包含期望数值答案。
- `ProblemEvidenceBundle` 以 raw-byte SHA-256 分别绑定 question authority 与 VISION-016 projection；`OcrLayoutSolverRequest` 再绑定 bundle、solver policy 和 expected interpretation。数值只能来自 projection 的 OCR-bound `recognizedText`，quantity/unit 只能来自 question authority。
- 当前 deterministic solver 只接受一个 ASCII decimal `measurement_reading`，canonical candidate 为 `12 cm`。`TrackResult` 分别记录 exact question binding、interpretation、candidate provenance 与 local/non-live/no-cloud solver provenance。
- canonical result 固定 high risk、blocking validator finding、review required、`humanApproved=false`、`trusted=false`、`visualReviewPassed=null`、controls not verified、`eligible=false`、`optimizationCandidateRefs=[]`；不生成 `DecisionRecord`，不接 Track C、WPF、gateway、delivery trust 或 optimizer。
- 本切片只证明 public synthetic Track B plumbing，不证明通用题意解析、数值/单位推断、真实量具读数、答案正确性、real-data quality、workflow integration、gateway verification 或 workstation/live acceptance；`ReadinessControlReceipt=unattested_local_record` 保持不变。

### VISION-018 synthetic Track C validator 边界

- `SyntheticTrackValidatorRequest` 以 raw-byte SHA-256 独立绑定 VISION-017 question、ProblemEvidenceBundle、solver request、Track B 与 VISION-016 projection，并固定七项 check inventory 和 validator policy。
- validator 分别检查 question binding、quantity、unit whole-token、ASCII decimal、exact answer format、semantic/solver provenance 与 review boundary；principal semantic mismatch 编译为 blocking finding，stale request/input hash 直接拒绝。
- canonical ConsistencyReport 七项全 pass，Track C 为 `rule_validator`；`groundingSufficient=true` 只表示这五份 public synthetic authority 足以完成这七项有限一致性检查，不证明真实题目 grounding、量具读数或答案正确。
- canonical Track C 固定 high risk、review required、`humanApproved=false`、`trusted=false`、`visualReviewPassed=null`、controls not verified、`eligible=false`、`optimizationCandidateRefs=[]`，且推荐 `acceptance_tier_unverified`。
- 本切片不生成 DecisionRecord，不做 Track A/B/C orchestration、比较/冲突/降级、WPF/review writeback、gateway live、workstation 或 live acceptance；`ReadinessControlReceipt=unattested_local_record` 保持不变。

### VISION-019 synthetic Track A/B/C orchestration 边界

- `TrackOrchestrationRequest` 绑定 VISION-017 question/ProblemEvidenceBundle/Track B、VISION-018 Track C 与同 question 的独立 public synthetic Track A current bytes，并固定 A/B/C required inventory 与 orchestration policy；请求不能缩小 required set 绕过 degradation。
- runtime 对每份 source 重新验证 repository-relative path、raw-byte SHA-256、Track type/id、evidence-bundle 与 exact question binding；A/B candidate normalization 直接复用 canonical DecisionRecord helper，不形成第二套比较语义。
- `TrackOrchestrationReport` 正交记录 A/B `agreement/conflict/not_comparable` 与 overall `complete/degraded`，并把 Track C disposition 与全源 blocking finding refs 分开；canonical Track C pass 不隐藏 Track B 的 `synthetic_track_b_requires_review` blocker。
- runtime 把 actual source tracks 和 required types 交给既有 DecisionRecord compiler；canonical DecisionRecord 为 `review_required`、`trusted=false`、`visualReviewPassed=null`、`high_risk_approval`，包含 `dual_track_match / rule_validator_failed / acceptance_tier_unverified / review_pending`，不输出 accepted answer。
- 本切片只证明 repo-side public synthetic source admission、orchestration 与 evidence-compiler runtime，不证明 Track A VLM、production Track B/C、答案正确、review approval、WPF workflow、gateway/workstation 或 live acceptance；controls 仍 not verified、`eligible=false`，`ReadinessControlReceipt=unattested_local_record` 不变，不生成 `OptimizationCandidate`。

### VISION-020 synthetic captured-page normalization 边界

- `VisualPageNormalizationRequest` 只接受从 VISION-007 current `junior-readable-measurement.source.png` 确定性生成的一份 `synthetic_fixture/public` capture，固定 720x540 dimensions、target 560x360、largest-external-quadrilateral policy、median-3 denoise 与 `allowCloud=false`。
- runtime 从 capture pixels 检测最大外部凸四边形，执行 perspective/orientation correction 与 denoise，并用 request/capture/normalized PNG raw-byte SHA-256、decoded RGB pixel SHA-256、geometry、corrections 和 OpenCV/Pillow provenance 绑定一份 `NormalizedPage`。
- canonical quadrilateral 为 `(74,89)/(646,61)/(670,470)/(56,484)`，area ratio `0.607368`、orientation `-2.802452` 度；这些只描述冻结 synthetic fixture，不是实拍质量指标。
- external runtime 仅写入仓外新目录，在 atomic directory promotion 前重验 staged PNG/result bytes 与 canonical request/capture snapshots；focused tests 不重写 canonical authority，显式 materialization 与验证分离。
- canonical `regionRefs=[]`，human review required、not accepted、controls not verified、`eligible=false`；本切片不做自动题区/图区/表格/公式/axis/tick/legend/component proposal 或语义，不接 OCR/Track/WPF/gateway，不构成 workstation/live acceptance，`ReadinessControlReceipt=unattested_local_record` 不变，不生成 `OptimizationCandidate`。

### VISION-021 synthetic automatic region proposal 边界

- `VisualRegionProposalRequest` raw-byte 绑定 VISION-020 normalization result 与 normalized PNG，固定 `synthetic_fixture/public`、560x360 page authority、empty `regionRefs`、8px inset、foreground threshold 180、3x3 close、8-connectivity、min area 20、8px padding、max 16 candidates 与 `allowCloud=false`。
- runtime 输出按 top-to-bottom/left-to-right 排序的 `RegionProposalCandidate[]`，记录 source/padded bbox、foreground/bbox area、coverage 与 boundary contact；canonical 恰有 `(254,147,53,65)` 和 `(89,255,386,26)` 两个 candidate。
- candidate 固定 `proposalKind=content_block_candidate / heuristicOnly=true`，不复用 `VisualRegion.regionType`，不允许 question/figure/text/formula/table/axis/scale/legend 等语义字段；uniform overlay 固定 `diagnostic_only`。
- external runtime 仅写入仓外新目录，在 atomic directory promotion 前重验 staged overlay/result bytes 与 canonical request/upstream snapshots；empty/excess candidate inventory、policy/hash/path drift 均 fail closed。
- canonical 固定 `semanticDisposition=not_inferred / visualRegionDisposition=not_generated / requiresHumanReview=true / not_accepted / controls=not_verified / eligible=false`；本切片不证明 region precision/recall，不生成 local high-res crop，不接 OCR/Track/WPF/gateway，不构成 workstation/live acceptance，`ReadinessControlReceipt=unattested_local_record` 不变，不生成 `OptimizationCandidate`。

### VISION-022 synthetic local crop 边界

- VISION-022 在 VISION-021 proposal 上生成 1x pixel-preserving 与 2x nearest crops；所有 artifacts 绑定 proposal/bbox/hash/pixels/dimensions，固定 nonsemantic/not integrated。
- 2x 是 nearest enlargement，不证明细节恢复或 OCR 改善，不生成 `VisualRegion`，controls=`not_verified`、`eligible=false`。

### VISION-023 explicit synthetic region semantics 边界

- `VisualSyntheticRegionSemanticsDeclaration` 是唯一语义 authority；它独立声明 `content-block-001 -> text_area / measurement_reading / recognized_value_component` 与 `content-block-002 -> scale_area / measurement_scale_baseline / scale_baseline_component`。runtime 禁止从像素、文件名、OCR、题干或答案反推这些字段。
- request raw-byte 绑定 declaration、VISION-021 proposal result 与 VISION-022 local-crop result；runtime 逐项重验 proposal kind/bbox、1x/2x crop actual bytes、decoded RGB pixel SHA-256、dimensions、interpolation 与 exact proposal coverage。
- result 生成两份 generic-shape `VisualRegion`，但 `classificationBasis=explicit_synthetic_region_semantics_declaration / inferenceDisposition=not_performed / questionBindingDisposition=not_established / trackDisposition=not_integrated / answerDisposition=not_generated`。
- crossed/duplicate/missing proposal refs、unsupported role/type/component、stale crop hash/bbox、schema/path/alias/staged-output/input-snapshot 或正向 trust 漂移均 fail closed；external runtime 只写仓外新目录并原子 promotion。
- 本切片只证明 explicit synthetic semantics compilation，不证明自动 region classification、真实图元质量、通用 axis/table/tick/legend/component understanding、FigureUnderstanding、question binding、OCR 改善、Track input、答案正确、review approval、delivery trust、WPF/gateway/workstation 或 live acceptance。`ReadinessControlReceipt=unattested_local_record`、controls=`not_verified`、`eligible=false` 不变，不生成 `OptimizationCandidate`。

### VISION-024 explicit synthetic component semantics 边界

- `VisualSyntheticComponentSemanticsDeclaration` 是唯一 component-type authority；它只把 current `junior-instrument-scale` line candidates 显式分组为 `line-007 + line-008 -> pointer_indicator` 和五组 `major_tick_mark` edge pairs。runtime 禁止从像素、几何、文件名、OCR、题干或答案推断 component type。
- request raw-byte 绑定 declaration、VISION-008 current structure result、VISION-007 current preprocessing result 与 actual 2x crop；runtime 重验 structure/preprocessing/crop bytes、decoded RGB pixel SHA-256、dimensions、candidate identity、segment geometry、pair uniqueness 与 computed bbox。
- result 固定 `semanticDisposition=explicit_declared / inferenceDisposition=not_performed / figureUnderstandingDisposition=not_generated / scaleInterpretationDisposition=not_established / readingDisposition=not_generated / questionBindingDisposition=not_established / trackDisposition=not_integrated / answerDisposition=not_generated`。
- crossed/duplicate/unsupported declaration、stale source/hash/segment geometry、schema/path/staged-output/input-snapshot 或正向 trust 漂移均 fail closed；external runtime 只写仓外新目录并原子 promotion。
- 本切片只证明 explicit synthetic component grouping compilation，不证明自动 tick/pointer detection、量程、分度值、数值或读数理解、FigureUnderstanding、Track input、答案正确、review approval、delivery trust、WPF/gateway/workstation 或 live acceptance。`ReadinessControlReceipt=unattested_local_record`、controls=`not_verified`、`eligible=false` 不变，不生成 `OptimizationCandidate`。

### Track 定义

- Track A：多模态视觉直答，使用原页图和局部高清 crop。
- Track B：OCR / layout / 图元抽取 / 结构化证据后再求解。
- Track C：规则校验器，检查单位、量程、分度值、坐标轴、图号绑定、答案格式和学科约束。

### 默认门禁

1. 双轨不一致：必复核
2. 双轨一致但命中高风险视觉题：强制复核或抽检
3. 三轨任一出现冲突、证据链缺失、低置信、图号绑定不稳或规则校验阻断：不得自动放行
4. 局部不确定但不阻断整份交付：对应小问标记 `【疑】/待复核`
5. `trusted=true` 只允许在无未决题、review lifecycle 达批准态、证据链完整且策略允许时出现

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
2. `historical_candidate` 或 `generated` 至少一桶 release-qualified `n >= 3` 且 qualified 判错召回率 `>= 0.70`
3. `check-toolchain` 全链为绿
4. 无 restricted 出网违规
5. 无 leakage 未决样例

`perturbed_negative` 单独达标绝不构成优化放行依据。
`diagnostic_only` 或 `unverified` 的非扰动样本只贡献 raw 诊断指标，绝不贡献上述 release-qualified 门槛。

## 12. P0-P3 sequence

### P0

- `$id + compatibility`
- `data-classification / sample-package / sample-index / negative-candidate / feedback-record` 等 schema 真值面
- `check-toolchain` 中的新增 schema 校验与 answer eval diff 强化
- 根文档与 strategy 真值面收口

### P1

- 飞轮骨架
- `SampleRunRecord / FeedbackParseResult / OptimizationCandidate / DecisionRecord`
- `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord` schema 契约和高风险标疑回归
- `renderer-contract` schema 契约和 Typst 主渲染迁移计划
- 样例真值面
- Track A
- WPF review 队列与反馈入口
- 生成主链后段接入

### P2

- Track B
- Track C 专用 validator
- 图片预处理副链、局部高清 crop、多尺度裁剪
- Word 原生解析
- 双轨 evidence / review / 灰度优化

### P3

- Prompt prose 优化
- 多 VLM ensemble
- Typst adapter、parity runner、rollback smoke
- 其他研究性增强

## 13. 三类人工队列

- `needs_human_label`：反馈解析置信不足
- `high_risk_approval`：高风险优化候选审批
- `truth_needs_review`：参考答案抽取不可靠、真值存疑或 leakage 未解决

三类队列必须分开，不能把真值问题误投到模型优化队列。

首个运行时投影采用显式、只读的 artifact selection：用户提供本地
`FeedbackParseResult / DecisionRecord / DeliveryDecisionAggregate` JSON 列表，projector 对每个来源执行
canonical path、raw-byte SHA-256、schema/semantic 与既有 source-aware 重验，再按合同中的
`humanQueue / reviewQueue` 原值投影。输入顺序不影响结果；重复、未知、损坏、路径别名或无法重验的
来源必须进入 rejected sources，并使整次投影 fail closed。该投影的 authority 固定为
`local_verified_projection`，不得生成审批、推进 lifecycle、修改 trust 或形成 `OptimizationCandidate`。

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
