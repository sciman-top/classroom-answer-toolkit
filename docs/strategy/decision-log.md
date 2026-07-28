# Decision Log

## D-001 规范真值区

- 决定：人类规范统一落在 `prompts/specs/`
- 原因：把规范真值从根目录散文中抽离，便于自动汇编与校验

## D-002 4 层规范结构

- 决定：平台总则 + K12通用 + 图文定量题通用 + 物理通用 + 学段特异
- 原因：既覆盖全项目，又避免把物理特异硬塞进过宽的通用层

## D-003 完整版保留层级

- 决定：完整版也是分层结构，自包含但不揉平
- 原因：便于精确同步、转发与溯源

## D-004 视觉优先

- 决定：看图错误视为跨学科最大误差源，采用双轨并行与高风险复核
- 原因：文本/LaTeX 化后 AI 通常可答对，视觉抽取才是主要障碍

## D-005 多学段物理

- 决定：初中物理与高中物理用独立 subject-pack，不继续塞进同一包
- 原因：知识边界和规则差异大，但平台 contract 应保持稳定

## D-006 自动作图答案图降级

- 决定：不再把“AI 自动基于题图生成作图题答案图”作为主需求，只保留受控插图插入底座
- 原因：真正高风险点在视觉理解与学科判断，错误一旦被画进图里，误导性比普通文字答案更强

## D-007 生成主链与交付链分离

- 决定：`原题 -> answer.md` 与 `answer.md -> PDF/review` 视为两条独立主链
- 原因：仓内当前成熟链只有交付链，生成主链是新增工程，不应藏在既有 deliver 工具里

## D-008 P1 飞轮先行，生成主链后接

- 决定：P1 先跑通样例飞轮与反馈链，生成主链作为后段可替换输入源接入
- 原因：飞轮是当前最重要的验收载体，而生成主链独立工程量更大

## D-009 样例真值面 schema 化

- 决定：为 `sample-package`、`sample-index`、`negative-candidate`、`sample-run-record` 建立明确契约
- 原因：样例配对、候选来源和回放统计不能长期靠命名约定与口头理解

## D-010 candidateSourceType 分桶放行

- 决定：按 `candidateSourceType` 分桶统计和放行，不允许只报总分
- 原因：`perturbed_negative` 的好成绩不能掩盖 `historical_candidate` 或 `generated` 的真实表现

## D-011 Word P1 degraded-supported

- 决定：P1 的 Word 只作为 `degraded-supported` 输入与真值来源；P2 才引入原生 `docx -> NormalizedPage`
- 原因：当前仓内没有稳定的 `docx/OpenXml/OMML` 解析实现，不能让 P1 范围失控

## D-012 feedback 归因模型升级

- 决定：反馈归因采用 `primaryErrorType + contributingErrorTypes[] + confidence`
- 原因：真实失败常是复合归因，单一 `errorType` 容易导致优化器过拟合

## D-013 三类人工队列分离

- 决定：人工入口拆分为 `needs_human_label`、`high_risk_approval`、`truth_needs_review`
- 原因：反馈低置信、优化审批和真值存疑是三种不同问题，混在同一队列会误导处理流程

## D-014 外置参考仓分层收口

- 决定：活跃外置参考仓只保留 `MVVM-Samples`、`Wpf.Extensions.Hosting`、`RapidOCR`；`marp-cli` 降为次级参考；`Text-Grab` 退出活跃清单；`Typst` 与 `OCRmyPDF` 只保留候选身份
- 原因：当前主链仍是 `WPF + Generic Host + Playwright/Chromium + RapidOCR`，其余仓要么只提供模式参考，要么属于第二阶段增强，不应继续伪装成当前主设计驱动

## D-015 视觉证据编译器优先

- 决定：高风险视觉题先编译为 `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`，再进入 AI 解题或 review；不允许从整页图直接跳到 `trusted=true`
- 原因：OpenAI vision 限制和文档 layout/OCR 最佳实践都说明，小字、旋转、图表样式、空间定位和结构抽取需要证据分层处理；核心目标是降低“看错还自信输出”的误放行率

## D-016 Typst 保持第二渲染候选

- 决定：当前主渲染链继续保持 Playwright / Chromium PDF review；Typst 只作为第二 PDF 后端候选，需通过分页、数学排版、证据定位、review 回写和维护成本对比后才可升级
- 原因：视觉降错的主瓶颈是证据抽取、绑定和复核闭环，不是渲染引擎本身；提前改主渲染会扩大风险面

## D-017 Typst 主渲染终局目标

- 决定：Typst 从“第二 PDF 后端候选”升级为终局主渲染目标；当前运行时仍保持 Playwright / Chromium，直到 Typst adapter、renderer contract、parity gate 和 rollback smoke 全部通过
- 原因：自动解题工作站终局需要更稳定的文档排版、PDF metadata、PDF 标准、可访问性策略和长期归档能力；Typst 官方导出与 PDF 能力更适合作为目标后端
- 边界：D-017 调整 D-016 的终局目标，但不改变当前默认 renderer，也不允许跳过 Chromium fallback

## D-018 移植 QQ 重链路为阶段化视觉证据产物

- 决定：吸收 `qq-codex-bot` 的 `visual_input_bundle / grounding_snapshot / solution_snapshot / consistency_checks` 思路，但在本仓落为 `VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` 阶段产物，并通过 `TrackResult.stageArtifactRefs` 引用
- 原因：不安全捷径和 grounding 不足是视觉误放行的核心风险；阶段化 trace 能把读图事实、解题候选和一致性校验拆开，且不破坏本仓既有 `ProblemEvidenceBundle / TrackResult / DecisionRecord` canonical contract
- 边界：不移植 NapCat、AstrBot、OneBot 或 QQ live 验收语义；本仓验收分层使用 `repo_supported / gateway_verified / workstation_accepted`

## D-019 原始诊断指标与 release qualification 分离

- 决定：`SampleRunRecord` 从 current canonical provenance 派生 `ReleaseQualification`，readiness 同时报告 raw 与 qualified 指标，非扰动放行门槛只读取 qualified 指标
- 原因：raw recall 证明当前 fixture 的诊断链路有效，但 deterministic `synthetic_fixture`、未认证历史样本或本地 unattested receipt 都不具 release authority；若复用 raw `n/recall`，未来 controls 转正会产生错误放行
- 边界：当前编译器只产生 `not_applicable / diagnostic_only / unverified`，不自行产生 `qualified`，不生成 `OptimizationCandidate`

## D-020 教师文本首切片采用显式词典并 fail closed

- 决定：首个 teacher feedback parser 只处理 hash-bound canonical fixture inventory 准入的公开 synthetic input；唯一非否定根因和唯一 severity 显式短语才生成 `teacher_input` record，其余情况统一进入 `needs_human_label`
- 原因：当前没有受验收的开放域中文语义模型或真实教师数据 authority；显式词典能先验证 input/run/hash/queue 合同而不伪装自然语言理解能力
- 边界：teacher parse result 当前不进入 readiness 判错统计，不消费真实数据，不生成 `OptimizationCandidate`，不接 WPF 或云

## D-021 教师反馈解析质量使用独立诊断报告

- 决定：canonical synthetic teacher feedback 的结构化率、人工分流率和归因分布由独立 `TeacherFeedbackDiagnosticReport` 统计，不扩展 `OptimizationReadinessReport`
- 原因：同一 candidate run 可同时产生 auto fixture label 和 teacher input feedback；若把 teacher parse result 当作新的 candidate evaluation unit，会重复计算判错 recall 并混淆 parser ingestion quality 与 candidate quality
- 边界：diagnostic report 必须绑定 inventory/result 原始字节、保留零计数类别且 optimization refs 为空；它不贡献 qualification、controls、eligibility 或真实教师语言理解结论

## D-022 教师反馈自动回放使用独立 byte-exact 诊断报告

- 决定：canonical synthetic teacher feedback 的自动回放通过率由独立 `TeacherFeedbackReplayDiagnosticReport` 统计，不扩展 ingestion diagnostic，也不以测试日志代替可版本化指标资产
- 原因：ingestion structured rate 衡量分流结果，replay pass rate 衡量当前 parser 对冻结 expected result 的兼容性；混在同一报告会把两个失败面耦合，仅保留测试又无法形成稳定、可绑定、可重算的产品指标
- 边界：replay 前必须先证明 expected authority 的 schema/hash/path/coverage 完整；合法 replay mismatch 只记为 diagnostic failure，不升级或改写 expected authority，不贡献 readiness、qualification、controls、eligibility 或 `OptimizationCandidate`

## D-023 高风险视觉指标使用按学科独立 synthetic 诊断报告

- 决定：VISION-004 使用 6 个 raw-byte-bound `synthetic_fixture` cases 和独立 `VisualRiskDiagnosticReport`，由当前 DecisionRecord compiler 重放 expected decision，并按三个 subject-pack 分别统计误放行、正确标疑、绑定准确率和 replay 通过率
- 原因：现有两个 math-only fail-closed fixture 只能证明局部 reason 投影，无法证明跨学科 coverage，也不能形成稳定、可重算的产品指标；把指标塞进 candidate readiness 又会混淆视觉合同诊断与优化放行 authority
- 边界：fixture 不冒充真实试卷或 live VLM 输出；报告不接 WPF/gateway/readiness candidate path，`optimizationCandidateRefs=[]`、controls=`not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-024 首个 review queue 采用显式只读 artifact 投影

- 决定：首个 WPF review queue 只消费用户显式选择且通过 canonical path、raw-byte SHA-256、schema/semantic 与既有 source-aware verifier 重验的 `FeedbackParseResult / DecisionRecord / DeliveryDecisionAggregate`；按来源合同原值映射三类队列
- 原因：现有 authority 已能表达 `humanQueue / reviewQueue`，无需发明新的审批或 trust 真源；显式输入清单也避免目录扫描把未知 JSON 静默纳入队列
- 边界：投影 authority 固定为 `local_verified_projection`；任何 rejected source 使整次投影 fail closed，不生成审批、不推进 lifecycle、不修改 manifest/trust，不生成 `OptimizationCandidate`，不宣称 workflow integrated 或 live accepted

## D-025 首个视觉预处理 runtime 采用显式 bbox 与确定性多尺度输出

- 决定：VISION-007 只接受 canonical inventory 准入的公开 synthetic bitmap、显式 integer `page_pixel` bbox 和固定 `[1,2]` scales；本地 OpenCV/Pillow runtime 输出 raw-byte/decoded-pixel hash-bound crops 与 engine provenance
- 原因：局部高清 crop 是 Track A/B 的共同输入底座，但当前没有已验收的 OCR/layout 或自动 region detection authority；先固定像素、坐标、hash、路径和重放合同，可验证预处理 plumbing 而不伪装视觉理解
- 边界：不做 OCR/layout 语义、自动检测、真实试卷、WPF/gateway/trust/readiness/optimizer 集成；不开 cloud egress，不生成 `OptimizationCandidate`，controls 保持 `not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-026 首个结构抽取 runtime 只产生非语义候选图元

- 决定：VISION-008 从 VISION-007 canonical 2x crop 运行冻结的 threshold/connected-components/Canny/Hough 算法，只输出规范化 line/connected/text-region candidates，并固定 OCR 未执行、语义未推断、Track 未集成
- 原因：像素结构抽取是 OCR/layout/Track B 的前置底座，但直接给 synthetic 图元贴 axis/tick/component 或文本标签会把 fixture knowledge 写进 extractor，形成虚假语义 authority
- 边界：candidate 不能升级为 `FigureUnderstandingResult / ProblemEvidenceBundle / TrackResult`，不做真实 OCR、学科分类、WPF/gateway/readiness/trust/optimizer 或 cloud egress；controls 保持 `not_verified`、`eligible=false`，不生成 `OptimizationCandidate`，不宣称 workflow integrated 或 live accepted

## D-027 首个 OCR runtime 只建立 observation authority，不建立 correctness authority

- 决定：VISION-009 对 committed synthetic 2x crop 运行 hash/version/parameter-bound local RapidOCR，原样记录空结果或错误文本，并固定 ground truth unavailable、not evaluated、requires human review、语义未推断、Track 未集成
- 原因：当前 fixture 可证明 OCR runtime plumbing 和 replay，但没有独立人工 truth authority；把 confidence、可见字符或 synthetic fixture knowledge 写成 expected correctness 会伪造 OCR acceptance
- 边界：不计算准确率/召回率，不生成 OCR/image conflict、layout relation、FigureUnderstandingResult、ProblemEvidenceBundle、TrackResult、DecisionRecord 或 OptimizationCandidate；不接 WPF/gateway/readiness/trust，不启 cloud egress，不使用真实数据，controls 保持 `not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-028 首个跨结构/OCR runtime 只建立穷举空间测量，不建立匹配 authority

- 决定：VISION-010 对 committed VISION-008 text-region bboxes 与 same-case VISION-009 OCR quads 做 exhaustive axis-aligned geometry measurement，固定 association 未决定、layout/semantic 未推断、Track 未集成
- 原因：现有 structure candidates 是 heuristic-only，OCR observations 没有 ground truth 且可为空或错误；选择“最佳匹配”或贴 layout 标签会把两个未验收 diagnostic surfaces 组合成虚假正向 authority
- 边界：measurement 只记录 refs、bounds、intersection/coverage/distance 与 geometry-only relation，不复制 OCR 文本、不使用阈值选 match、不生成 FigureUnderstandingResult、ProblemEvidenceBundle、TrackResult、DecisionRecord 或 OptimizationCandidate；不接 WPF/gateway/readiness/trust，不启 cloud egress，不使用真实数据，controls 保持 `not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-029 首个 OCR correctness 诊断只使用 generator-declared synthetic truth

- 决定：VISION-011 将 VISION-007 deterministic renderer 中显式 text/coordinate declarations 固化为 raw-byte-bound `VisualSyntheticTextTruth`，只对 fully-visible label 与 VISION-009 observation 执行 exact case-sensitive text + positive-overlap diagnostic matching，并按 subject-pack 独立报告 precision/recall availability 与漏检/误检
- 原因：直接从 observation confidence、可见像素猜 truth 或把 heuristic region 当 OCR label 会伪造 correctness；renderer source declaration 是当前唯一可审计、无需真实数据且不依赖 OCR 输出的 synthetic truth 起点，但仍不具人工或生产 acceptance authority
- 边界：partially-clipped/outside label 不进入召回分母；报告固定 not accepted、需人工复核、layout/semantic/Track 未集成，不构成人工 truth、真实 OCR benchmark、OCR acceptance、OCR-region association、FigureUnderstanding 或 Track B；不接 WPF/gateway/readiness/trust/optimizer，不启 cloud egress，不使用真实数据，不生成 `OptimizationCandidate`，controls 保持 `not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-030 首个 text-region correctness 诊断只评估 generator truth 的空间覆盖

- 决定：VISION-012 将 VISION-011 generator-declared synthetic truth 与 VISION-008 heuristic text-region candidates 做 positive-area one-to-one diagnostic matching；fully-visible truth 进入召回分母，partial overlap candidate 只记 unscored，outside truth 不保护 candidate，并按 subject-pack 独立报告 precision/recall availability 与漏检/误检
- 原因：当前三个 fixture 已存在可审计且与 extractor 独立的 source declaration truth；实际几何探针显示三个 fully-visible label 各有唯一 positive-overlap candidate，而 22 个其余 candidate 只命中 partially-clipped header。该诊断能验证 proposal plumbing，但不需要读取文字或依赖未验收 OCR
- 边界：报告不得复制 truth text、识别 candidate 文本或选择 OCR-region association；ambiguous repeated overlap fail closed；不构成人工 truth、真实 region benchmark、layout semantics、FigureUnderstanding 或 Track B；不接 WPF/gateway/readiness/trust/optimizer，不启 cloud egress，不使用真实数据，不生成 `OptimizationCandidate`，controls 保持 `not_verified`、`eligible=false`，不宣称 workflow integrated 或 live accepted

## D-031 AI 视觉复核的等效性只在 synthetic diagnostic scope 内成立

- 决定：VISION-013 将当前 AI 对三份公开 synthetic crop 的视觉判断记录为 `VisualMachineReviewReceipt`；reviewer 身份固定 `ai_agent / humanReviewed=false`，但在显式 `synthetic_fixture_equivalent / synthetic_fixture_diagnostic` 政策内可替代人工视觉检查
- 原因：用户授权 AI 视觉审查作为真人替代，但把机器身份写成 `humanApproved` 会破坏审计和未来真实数据治理；独立 receipt 既能让本切片获得可追踪的视觉验收，又保留 reviewer 身份、artifact bytes、观察面和限制真相
- 边界：machine review 不进入既有 human approval 字段，不推进 review lifecycle，不修改 DecisionRecord/delivery trust/WPF/readiness/live authority；只使用公开 synthetic fixture，不开启 cloud egress，不生成 `OptimizationCandidate`，controls 保持 `not_verified`、`eligible=false`

## D-032 OCR-region association 只接受双向唯一的正交面积证据

- 决定：VISION-014 只把 VISION-010 中 positive-area、non-disjoint 且 observation/candidate 双向唯一的 measurement 投影为 diagnostic association；零 observation/candidate 为 unavailable，无 eligible edge 为 unmatched，任一端多 eligible edge 必须 fail closed
- 原因：risk-first probe 显示当前 frozen authority 只有两个 empty-observation case 和一个 disjoint pair，没有可诚实提升为 canonical success 的正向样例；距离最近、OCR confidence 或 fixture truth 都不能修复这一证据缺口
- 边界：canonical report 固定保留两例 unavailable、一例 unmatched、零 matched；正向与歧义只用非权威 policy 单元输入验证算法，不进入 canonical fixture、generated/historical/human sample 或 acceptance authority；不复制 OCR/truth text，不生成 layout semantics、FigureUnderstanding、Track B、delivery trust、WPF/live state 或 `OptimizationCandidate`，controls 保持 `not_verified`、`eligible=false`
