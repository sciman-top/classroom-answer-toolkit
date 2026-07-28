# Implementation Plan

## 目标

把最终基线按可执行 slice 拆成工程实施计划，使实现者能沿着 `P0 -> P1 -> P2 -> P3` 顺序推进，而不重新解释需求边界。

## P0：文档与契约真值面收口

### 输入

- `docs/strategy/` 真值文档
- `prompts/specs/README.md`
- 现有 `prompts/shared/schemas/`
- 现有 `scripts/check-toolchain.ps1`

### 输出

- 新增与更新后的文档真值面
- 新增 schema 清单与命名约束
- `check-toolchain` 的新增校验要求说明

### 涉及文件面

- `docs/strategy/`
- `prompts/specs/README.md`
- `prompts/shared/schemas/`
- `scripts/check-toolchain.ps1`

### 完成定义

- `docs/strategy/` 成为唯一规划与实施入口
- `sample-package / sample-index / negative-candidate` 的字段形状被固定
- 运行时与文档对 `status`、`questionId`、`runMode`、`candidateSourceType` 的口径一致

### 验证方式

- 文档链接和术语一致性检查
- `validate:assets` / `check-toolchain` 设计更新通过

### 禁止扩张点

- 不在 P0 实现生成主链
- 不在 P0 做视觉双轨运行时
- 不在 P0 修改业务逻辑以外的产品承诺

## P1：飞轮先行

### 输入

- P0 后的 schema 与文档真值面
- `样例交付/` 中现有可复用样例
- 负样本候选

### 输出

- canonical index/package/candidate-descriptor hash authority 约束下、通过仓内有限 shape validator、compiler semantic invariants 与 current canonical authority bytes 重验的 `SampleRunRecord`
- source-run-byte-bound、只接受 non-exact synthetic fixture scoring 的 `FeedbackParseResult`
- source-run/input-byte-bound、仅对公开 synthetic 明确词典信号做确定性归因或 `needs_human_label` 分流的 teacher-text `FeedbackParseResult`
- inventory/result-byte-bound、独立于 candidate readiness 的 `TeacherFeedbackDiagnosticReport`
- inventory/submission/expected-result/replayed-result-byte-bound、独立于 ingestion 与 candidate readiness 的 `TeacherFeedbackReplayDiagnosticReport`
- canonical-case-inventory-bound、缺 run/反馈仍计入召回分母的 fail-closed `OptimizationReadinessReport`
- clean-revision、ordered-gate-log-bound、保持 controls 未验证的 `ReadinessControlReceipt`
- `OptimizationCandidate`
- `DecisionRecord`
- `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord` schema 契约
- raw-byte-bound、按 subject-pack 分桶且与 readiness 分离的 `VisualRiskCaseInventory / VisualRiskDiagnosticReport`
- `renderer-contract` schema 契约与 Typst 主渲染迁移计划
- hash-bound、用户显式触发的 WPF aggregate 附着后立即重验投影
- provider-neutral、用户显式选择且 source-aware 重验的三类 review queue 只读投影
- 第一版自动验收飞轮

### 涉及文件面

- `样例交付/`
- `artifacts/runs/`
- `feedback/`
- WPF review / feedback 入口

### 完成定义

- 能跑通至少一个 `plumbing` 轮和一个 `scoring` 轮
- 首个 scoring 增量允许只做完全合成 fixture 的 byte/hash exact-diff 与预标注根因记账，但必须明确不等于语义评分或优化放行
- 候选答案与真值分离明确
- 三类人工队列可区分
- Word 在 P1 明确只作为 `degraded-supported`
- 高风险视觉题即使双轨一致，只要证据链缺失也保持 `trusted=false`
- 三个 subject-pack 的 synthetic visual-risk fixture 可独立报告误放行、正确标疑、绑定准确率和 byte-exact replay，不把诊断指标升级为 live authority
- 当前 renderer truth 和 Typst target renderer 不再混写
- WPF 可显式选择已有本地 aggregate 交给受控工具附着；正向 trust 只来自附着后立即执行且匹配 `manifestResultSha256` 的本次重验，普通读取仍 fail-closed
- WPF 可显式多选已有本地 review artifact；只有全部来源通过 canonical path、raw-byte hash 与既有 verifier 重验时才展示 `local_verified_projection`，任一 rejected source 使整次队列投影 fail closed

### 验证方式

- 样例回放
- 分层判错验证
- 负样本判错召回验证
- teacher feedback 唯一信号、歧义信号与缺失信号的 fail-closed 分流验证
- teacher feedback structured/human-label rate 与 error/severity/reason 完整分布的确定性重算验证
- teacher feedback parser 对 canonical expected result 的逐 fixture raw-byte 回放通过率验证
- visual-risk inventory/evidence/tracks/expected decision 的 raw-byte authority 与逐 subject-pack 指标重算验证
- review queue 三类映射、顺序无关、重复/未知/损坏/alias/source 漂移的 fail-closed 验证

### 禁止扩张点

- 不把 `reference_truth` 当 `candidate`
- 不让 P1 因 Word 原生解析或图片高级预处理而膨胀
- 不允许优化信号绕过 `runMode` 与数据边界
- 不把 synthetic visual-risk diagnostics 解释为真实图像/VLM 质量、gateway live verified、workflow integrated 或 live accepted
- 不让 review queue 投影生成审批、推进 lifecycle、修改 trust 或产生 `OptimizationCandidate`

## P1 后段：答案生成主链接入

### 输入

- 已经可运行的飞轮骨架
- 现有 `answer.md -> PDF/review` 交付链

### 输出

- provider-neutral、严格 schema 化的 `AnswerGenerationRequest / AnswerGenerationResult`
- 明确标记 `synthetic_fixture` 且 `liveProvider=false` 的确定性本地 generator
- request/result/candidate raw bytes 的 SHA-256 与 canonical provenance 绑定
- 三个脱敏 `generated` 类型候选接入飞轮

### 涉及文件面

- 生成主链接口
- `tools/answer-generator`
- `prompts/shared/schemas/` 与 `ClassroomToolkit.Domain.Generation`
- 完全合成的 generation eval 与 canonical sample authority
- 飞轮 candidate source 接口

### 完成定义

- `generated` 候选能被飞轮读取、比对、记账和分桶统计
- 与现有 `AnswerDeliveryRequest` 明确分离
- 生成物结构、provenance、request/result/candidate 原始字节和 canonical authority 漂移均 fail closed
- `generated n=3` 可独立统计，但 `toolchain/restricted-egress=not_verified`、`eligible=false`、`optimizationCandidateRefs=[]`
- raw generated 指标与 release-qualified 指标分离；synthetic fixture 固定为 `diagnostic_only`，因此当前 generated `qualifiedN=0` 且 qualified recall unavailable

### 验证方式

- 生成候选进入 scoring
- `candidateSourceType=generated` 的分桶结果可被单独查看
- generation 与 sample-flywheel focused tests、assets semantic recompile、完整固定顺序门禁
- qualification provenance、inventory/run/report 漂移回归，以及“raw 门槛达标仍不能放行”的 eligibility 回归

### 禁止扩张点

- 不在这一阶段把生成主链与交付主链揉成一条黑盒链
- 不接 WPF、不启 cloud egress、不使用真实试卷、不生成 `OptimizationCandidate`
- deterministic fixture 不冒充真实模型或 historical candidate，不提升本地 receipt authority

## P2：双轨视觉与原生输入

### 输入

- P1 飞轮与 feedback 主链
- Track A 运行结果

### 输出

- Track B
- Track C validator
- 视觉证据编译运行时
- 双轨比对器
- 图片副链与 Word 原生解析
- VISION-007 provider-neutral 显式 bbox 本地预处理 runtime；三个 subject-pack 各一个公开 synthetic bitmap，固定输出 1x/2x crop 并记录 raw-byte/pixel hash 与 engine provenance
- VISION-008 provider-neutral 结构抽取 runtime；只从三个 canonical 2x crop 输出非语义 line/connected/text-region candidates，明确不执行 OCR、不分类学科图元、不生成 TrackResult
- VISION-009 provider-neutral OCR observation runtime；只记录三个 canonical 2x crop 的 frozen local RapidOCR 原始观察，允许空结果和错误文本，明确不构造 ground truth、不计算准确率、不生成 layout/TrackResult
- VISION-010 provider-neutral spatial observation runtime；只对 canonical text-region candidates 与 OCR quads 做穷举 geometry measurement，明确不选择匹配、不推断 layout/semantic、不生成 TrackResult
- VISION-011 provider-neutral OCR diagnostic runtime；只对 generator-declared synthetic text/bbox truth 与 canonical OCR observations 做 exact-text/positive-overlap 诊断，按 subject-pack 报告漏检/误检和 unavailable 分母
- VISION-012 provider-neutral text-region diagnostic runtime；只对 generator-declared synthetic text/bbox truth 与 canonical heuristic text-region candidates 做 positive-overlap 诊断，按 subject-pack 报告 fully-visible truth recall、candidate precision 与 partial unscored 数量
- VISION-013 provider-neutral machine visual review compiler；只把当前 `ai_agent` 对 canonical synthetic crop 的显式 verdict/checks/limitations 固化为 hash-bound receipt，并按 subject-pack 重算 diagnostic-scope review coverage

### 涉及文件面

- `tools/visual/`
- `tools/ocr/`
- `tools/visual-preprocessor/`
- `tools/visual-structure-extractor/`
- `tools/visual-spatial-observer/`
- `tools/visual-ocr-diagnostics/`
- `tools/visual-text-region-diagnostics/`
- `tools/visual-machine-review/`
- `eval/visual-preprocessing/`
- `eval/visual-structure-extraction/`
- `eval/visual-spatial-observation/`
- `eval/visual-ocr-diagnostics/`
- `eval/visual-text-region-diagnostics/`
- `eval/visual-machine-review/`
- `prompts/shared/schemas/visual-preprocessing-*.schema.json`
- `prompts/shared/schemas/visual-structure-extraction-*.schema.json`
- `prompts/shared/schemas/visual-spatial-observation-*.schema.json`
- `prompts/shared/schemas/visual-ocr-diagnostic-*.schema.json`
- `prompts/shared/schemas/visual-text-region-diagnostic-*.schema.json`
- `prompts/shared/schemas/visual-machine-review-*.schema.json`
- evidence / review 文档与运行产物

### 完成定义

- 高风险图题可以被 evidence 化、分流、复核和回写
- `generated` 桶进入正式放行矩阵
- 显式 `page_pixel` bbox 可确定性生成且重验 1x/2x synthetic crop；它只证明 preprocessing plumbing，不等于 OCR/layout/Track runtime
- canonical 2x crop 可确定性生成并重验非语义结构候选；它只证明 primitive extraction plumbing，不等于 OCR、layout semantics、FigureUnderstandingResult 或 Track B
- canonical 2x crop 可在 admitted package/model hashes 上重放 OCR observation；它只证明 OCR plumbing，不等于识别正确、OCR acceptance、layout semantics 或 Track B
- canonical structure/OCR results 可确定性重放 exhaustive spatial measurements；它只证明 geometry plumbing，不等于匹配正确、layout semantics、FigureUnderstanding 或 Track B
- renderer source declarations 与 canonical OCR results 可确定性重算 synthetic diagnostic metrics；它只证明三份冻结 fixture 的 exact-text 漏检/误检，不等于人工 truth、真实 OCR benchmark 或 OCR acceptance
- renderer source declarations 与 canonical structure results 可确定性重算 text-region diagnostic metrics；它只证明三份冻结 fixture 的 spatial proposal coverage，不等于文字识别、OCR-region association、layout semantics 或 Track B acceptance
- current AI visual checks 可由 raw-byte-bound receipts 与 deterministic aggregate report 重验；它只在 `synthetic_fixture_diagnostic` 范围内等效替代人工检查，不能冒充 human identity、delivery trust 或 live acceptance

### 验证方式

- 双轨一致/不一致样例
- 双轨一致但证据缺失样例
- VLM 错但 OCR/layout 对、OCR 错但 VLM 对、两者都错但规则校验拦截样例
- review 回写
- 分桶灰度验证
- preprocessing schema、canonical inventory、path/hash/alias/bbox/computed-field 漂移与 deterministic replay 验证
- structure extraction schema、preprocessing/crop authority、algorithm parameters、candidate ordering/counts 与 deterministic replay 验证
- OCR observation schema、preprocessing/crop/structure sibling authority、package/model/config hashes、observation ordering/counts 与 deterministic replay 验证
- spatial observation schema、structure/OCR/crop sibling authority、Cartesian coverage、geometry/ordering/rounding/computed fields 与 deterministic replay 验证
- synthetic text truth/schema、renderer/source/crop/OCR authority、visibility、exact-text/positive-overlap matching、metric denominator/computed fields 与 deterministic replay 验证
- synthetic text-region diagnostic schema、truth/structure/crop authority、visibility、positive-overlap matching、ambiguity、metric denominator/computed fields 与 deterministic replay 验证
- machine visual review schema、preprocessing/crop/receipt raw-byte authority、reviewer identity、synthetic-only equivalence policy、完整 check coverage、known limitations 与 aggregate replay 验证

### 禁止扩张点

- 不提前承诺“视觉题全自动可信放行”
- 不把显式 synthetic crop 冒充自动 region 检测、OCR/layout 语义、真实试卷效果或 Track A/B/C 集成
- 不把 line/connected/text-region candidate 冒充 axis/tick/circuit component、recognized text、FigureUnderstandingResult 或 Track B evidence
- 不把 OCR observation/confidence 冒充 ground truth、正确率、OCR acceptance、layout/semantic evidence 或 Track B result
- 不把 pairwise spatial measurement 冒充 OCR-region association、layout parse、FigureUnderstandingResult 或 Track B evidence
- 不把 generator-declared synthetic diagnostic 冒充人工标注、真实 OCR 质量、OCR acceptance、layout parse、FigureUnderstandingResult 或 Track B evidence
- 不把 generator-declared text-region diagnostic 冒充 recognized text、OCR-region association、layout semantics、FigureUnderstandingResult 或 Track B evidence
- 不把 `ai_agent` machine review 冒充真人身份、`humanApproved`、真实数据验收、delivery trust 或 live acceptance
- 不接 WPF/gateway/trust/readiness/optimizer，不开启 cloud egress，不生成 `OptimizationCandidate`

## P3：研究项

### 输入

- P2 完整链路
- 稳定的错例资产和统计口径

### 输出

- Prompt prose 优化研究
- 多 VLM ensemble 研究
- Typst adapter、parity runner 与 rollback smoke 研究
- 其他增强能力评估

### 完成定义

- 研究项不再只是想法，而有明确的验证数据和退出条件

### 验证方式

- A/B 评测
- 回放对比
- 误放行率与回滚率追踪

### 禁止扩张点

- 不让研究项倒逼主链提前承诺
