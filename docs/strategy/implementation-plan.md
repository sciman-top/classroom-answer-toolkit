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
- VISION-014 provider-neutral OCR-region association diagnostic；只从 canonical VISION-008/009/010 authority 选择双向唯一的 positive-area edge，按 subject-pack 报告 matched/unmatched/ambiguous/unavailable，当前 canonical truth 保持零正向 match
- VISION-015 public synthetic positive-association fixture；完整重放 VISION-007 至 VISION-014，在不改变 association policy 的前提下追加一份 exact OCR truth、唯一 text-region coverage 与双向唯一 positive-area canonical match，并保持 diagnostic-only 边界
- VISION-016 explicit semantic-role projection；以独立 declaration 为唯一角色真源，只在 VISION-011/012/014 精确连接同一 truth/OCR/candidate 时投影 `measurement_reading` 和绑定 OCR text，并保持 FigureUnderstanding/Track/answer/trust/live 全部未生成或未集成
- VISION-017 synthetic OCR layout solver；以独立 public question authority 明示 quantity/unit，绑定 VISION-016 OCR-derived reading 与 ProblemEvidenceBundle，输出一份 provenance-complete 且固定 review-required 的 Track B candidate
- VISION-018 synthetic Track C validator；独立重载 question/bundle/projection/solver-request/Track B 五份 raw-byte authority，输出七项 consistency checks、ConsistencyReport 与固定 review-required 的 `rule_validator` TrackResult
- VISION-019 synthetic Track A/B/C orchestration；准入 independent A/B/C current bytes，正交报告 comparison/degradation/Track C/source blockers，并复用 canonical DecisionRecord compiler
- VISION-020 synthetic captured-page normalization；在自动 region proposal 前检测固定透视/旋转/噪声 capture 的 page quadrilateral，输出 hash-bound 560x360 `NormalizedPage` 与 PNG，保持 `regionRefs=[]`
- VISION-021 synthetic automatic region proposal；绑定 VISION-020 current result/PNG，在 normalized coordinates 输出 `heuristicOnly` content-block candidates 与 diagnostic overlay，不生成 semantic `VisualRegion`
- VISION-022 synthetic local crops；每个 admitted proposal 生成 1x/2x hash-bound crops，保持 nonsemantic/nonintegrated
- VISION-023 explicit synthetic region semantics；独立 declaration 分别声明 reading block 与 scale baseline，并把 VISION-021 proposal、VISION-022 1x/2x crop bytes 编译为两份有限 VisualRegion；不执行推断或 question/Track/answer 绑定
- VISION-024 explicit synthetic component semantics；将 current instrument-scale line candidates 显式分组为一组 pointer edge pair 与五组 major-tick edge pairs，保持 scale interpretation/reading/FigureUnderstanding/Track/answer 未生成

### 涉及文件面

- `tools/visual/`
- `tools/ocr/`
- `tools/visual-preprocessor/`
- `tools/visual-structure-extractor/`
- `tools/visual-spatial-observer/`
- `tools/visual-ocr-diagnostics/`
- `tools/visual-text-region-diagnostics/`
- `tools/visual-machine-review/`
- `tools/visual-ocr-region-association/`
- `eval/visual-preprocessing/`
- `eval/visual-structure-extraction/`
- `eval/visual-spatial-observation/`
- `eval/visual-ocr-diagnostics/`
- `eval/visual-text-region-diagnostics/`
- `eval/visual-machine-review/`
- `eval/visual-ocr-region-association/`
- `eval/visual-semantic-projection/`
- `eval/ocr-layout-solver/`
- `eval/synthetic-track-validator/`
- `prompts/shared/schemas/visual-preprocessing-*.schema.json`
- `prompts/shared/schemas/visual-structure-extraction-*.schema.json`
- `prompts/shared/schemas/visual-spatial-observation-*.schema.json`
- `prompts/shared/schemas/visual-ocr-diagnostic-*.schema.json`
- `prompts/shared/schemas/visual-text-region-diagnostic-*.schema.json`
- `prompts/shared/schemas/visual-machine-review-*.schema.json`
- `prompts/shared/schemas/visual-ocr-region-association-*.schema.json`
- `prompts/shared/schemas/visual-*-semantic-*.schema.json`
- `tools/visual-semantic-projector/`
- `prompts/shared/schemas/visual-synthetic-question.schema.json`
- `prompts/shared/schemas/ocr-layout-solver-request.schema.json`
- `tools/ocr-layout-solver/`
- `prompts/shared/schemas/synthetic-track-validator-request.schema.json`
- `tools/synthetic-track-validator/`
- `prompts/shared/schemas/track-orchestration-request.schema.json`
- `prompts/shared/schemas/track-orchestration-report.schema.json`
- `tools/track-orchestrator/`
- `prompts/shared/schemas/visual-page-normalization-*.schema.json`
- `tools/visual-page-normalizer/`
- `eval/visual-page-normalization/`
- `prompts/shared/schemas/visual-region-proposal-*.schema.json`
- `tools/visual-region-proposer/`
- `eval/visual-region-proposal/`
- `prompts/shared/schemas/visual-*-region-semantics-*.schema.json`
- `tools/visual-region-semantics/`
- `eval/visual-region-semantics/`
- `prompts/shared/schemas/visual-*-component-semantics-*.schema.json`
- `tools/visual-component-semantics/`
- `eval/visual-component-semantics/`
- evidence / review 文档与运行产物

### 完成定义

- 高风险图题可以被 evidence 化、分流、复核和回写
- `generated` 桶进入正式放行矩阵
- 显式 `page_pixel` bbox 可确定性生成且重验 1x/2x synthetic crop；它只证明 preprocessing plumbing，不等于 OCR/layout/Track runtime
- canonical 2x crop 可确定性生成并重验非语义结构候选；它只证明 primitive extraction plumbing，不等于 OCR、layout semantics、FigureUnderstandingResult 或 Track B
- canonical 2x crop 可在 admitted package/model hashes 上重放 OCR observation；它只证明 OCR plumbing，不等于识别正确、OCR acceptance、layout semantics 或 Track B
- canonical structure/OCR results 可确定性重放 exhaustive spatial measurements；它只证明 geometry plumbing，不等于匹配正确、layout semantics、FigureUnderstanding 或 Track B
- renderer source declarations 与 canonical OCR results 可确定性重算 synthetic diagnostic metrics；当前四份 fixture 保留前三份漏检/误检并新增一份 exact-text 正向诊断，不等于人工 truth、真实 OCR benchmark 或 OCR acceptance
- renderer source declarations 与 canonical structure results 可确定性重算 text-region diagnostic metrics；当前四份 fixture 保留前三份结果并新增一份唯一正向 coverage，不等于文字识别、真实 region benchmark、layout semantics 或 Track B acceptance
- current AI visual checks 可由 raw-byte-bound receipts 与 deterministic aggregate report 重验；它只在 `synthetic_fixture_diagnostic` 范围内等效替代人工检查，不能冒充 human identity、delivery trust 或 live acceptance
- canonical structure/OCR/spatial authority 可确定性重算 association policy outcome；当前证明两例 unavailable、一例 unmatched 与一例 public synthetic matched，不能把 fixture coverage 冒充真实 association 质量
- 独立 semantic declaration 与 canonical OCR/text-region/association authority 可确定性重算一份 `measurement_reading` projection；角色与 recognized text 来源分离，不能冒充 layout、FigureUnderstanding、Track B、答案或真实语义理解
- public synthetic question、ProblemEvidenceBundle、VISION-016 projection 与 solver policy 可确定性重算一份 `12 cm` Track B candidate；它固定 review required，不能冒充通用 quantity/unit understanding、Track C、DecisionRecord acceptance 或 workflow/live acceptance
- current VISION-016/017 五份 raw-byte authority 可确定性重算七项 synthetic Track C check、一份 ConsistencyReport 与一份 `rule_validator` TrackResult；checks pass 只证明有限一致性，不能冒充真实 grounding、Track orchestration、答案批准、DecisionRecord trust 或 workflow/live acceptance
- current public synthetic question/bundle 与 independent Track A/B/C bytes 可由真实 runtime 准入、比较、降级并交给 canonical DecisionRecord compiler；它只证明 repo-side orchestration plumbing，不能冒充 provider execution、答案批准、WPF/gateway/workstation 或 live acceptance
- current VISION-007 source 可确定性生成带透视/旋转/噪声的 public synthetic capture，并检测/校正/重放一份 560x360 `NormalizedPage`；它只证明 page-normalization plumbing，`regionRefs=[]`，不能冒充自动 region、真实照片质量、OCR/layout/semantic/Track 或 workflow/live acceptance
- current VISION-020 normalized bytes 可确定性重算两个 nonsemantic content-block proposals 与 diagnostic overlay；它只证明 automatic proposal plumbing，不能冒充 question/figure/text/axis/table semantics、`VisualRegion`、region benchmark、OCR/Track 或 workflow/live acceptance
- 独立 region-semantics declaration、current proposal bytes 和四份 crop bytes 可确定性重算两份有限 VisualRegion；`explicit_declared` 不等于像素分类、通用图元理解、question binding、FigureUnderstanding、Track input、答案或 trust authority
- 独立 component-semantics declaration、current structure bytes 和 actual 2x crop 可确定性重算一组 pointer 与五组 major-tick edge groups；不等于自动 component detection、量程/分度值/读数理解或 FigureUnderstanding

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
- OCR-region association schema、三层 upstream/crop authority、双向唯一 positive-area policy、空 observation、disjoint unmatched、歧义 fail-closed、availability ratio 与 canonical replay 验证
- semantic projection schema、declaration/三角 endpoint/crop/hash/path/alias/TOCTOU/staged-output、source separation、负向 disposition 与 canonical replay 验证
- synthetic question/ProblemEvidenceBundle/solver request/TrackResult schema、question/hash/crop/role/numeric/unit/provenance/review disposition、external output 与 canonical replay 验证
- synthetic Track C request/ConsistencyReport/TrackResult schema、五输入 hash/provenance、七项 pass/blocking mutation、review disposition、atomic directory output、path/junction rejection与 canonical replay 验证
- Track orchestration request/report/DecisionRecord schema、A/B agreement/conflict、missing A/C degradation、Track C/source blocker、required-set/source/hash/question/path/junction 与 atomic two-output canonical replay 验证
- page normalization request/result schema、capture/request/output raw-byte 与 pixel hash、quadrilateral/area/orientation/corrections/provenance、no-page/policy drift、path/junction、staging tamper、input snapshot 与 atomic PNG+result canonical replay 验证
- region proposal request/result schema、normalization/result/PNG hash、exact candidate fields/order/bounds/area/coverage、empty/excess inventory、policy/path/junction、staging/input snapshot 与 atomic overlay+result canonical replay 验证
- region semantics declaration/request/result schema、proposal/crop raw-byte/pixel/bbox/scale coverage、交叉引用、重复/缺失声明、unsupported role/type、trust escalation、path/junction、staging/input snapshot 与 atomic result replay 验证
- component semantics declaration/request/result schema、structure/preprocessing/crop hash、candidate pair uniqueness/geometry/bbox、unsupported type、trust escalation、path/staging/input snapshot 与 atomic replay 验证

### 禁止扩张点

- 不提前承诺“视觉题全自动可信放行”
- 不把显式 synthetic crop 冒充自动 region 检测、OCR/layout 语义、真实试卷效果或 Track A/B/C 集成
- 不把 line/connected/text-region candidate 冒充 axis/tick/circuit component、recognized text、FigureUnderstandingResult 或 Track B evidence
- 不把 OCR observation/confidence 冒充 ground truth、正确率、OCR acceptance、layout/semantic evidence 或 Track B result
- 不把 pairwise spatial measurement 冒充 OCR-region association、layout parse、FigureUnderstandingResult 或 Track B evidence
- 不把 generator-declared synthetic diagnostic 冒充人工标注、真实 OCR 质量、OCR acceptance、layout parse、FigureUnderstandingResult 或 Track B evidence
- 不把 generator-declared text-region diagnostic 冒充 recognized text、OCR-region association、layout semantics、FigureUnderstandingResult 或 Track B evidence
- 不把 `ai_agent` machine review 冒充真人身份、`humanApproved`、真实数据验收、delivery trust 或 live acceptance
- 不把 policy 单元测试的正向 geometry 冒充 canonical fixture、OCR truth、真实 association 效果、layout semantics 或 Track B evidence
- 不从 truth text、OCR confidence、geometry、文件名或 subject rules 推断 semantic role；不把单角色 projection 冒充数值/单位理解、FigureUnderstanding、Track B、answer candidate 或 solver result
- 不把题干显式 quantity/unit authority 冒充通用 NLP 或单位推断；不把 synthetic Track B candidate 提升为已批准答案、Track C 结论、DecisionRecord trust 或 WPF/live workflow
- 不把七项 synthetic Track C pass、`groundingSufficient=true` 或 deterministic confidence 冒充真实题目 grounding、solver correctness、三轨编排、review approval、delivery trust 或 live acceptance
- 不把 synthetic Track A/B agreement、Track C pass、`orchestrationStatus=complete` 或已生成 DecisionRecord 冒充真实 provider orchestration、答案正确、review approval、workflow integrated 或 live acceptance
- 不把一份 synthetic captured-page detection/normalization 冒充自动题区/图区检测、真实拍照鲁棒性、OCR/layout/图元语义、Track input、WPF workflow 或 live acceptance
- 不把 heuristic content-block proposal 或 diagnostic overlay 冒充 `VisualRegion`、题区/图区/文字/公式/表格/axis/scale/legend 分类、真实 region 质量、OCR/Track input 或 live acceptance
- 不把 VISION-023 的 explicit synthetic declaration 冒充自动分类质量、通用 axis/table/tick/legend/component 理解、题目绑定、FigureUnderstanding、Track/answer authority 或 live acceptance
- 不把 VISION-024 edge grouping 冒充自动 tick/pointer 检测、scale range/division/reading 理解、FigureUnderstanding、Track/answer authority 或 live acceptance
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
