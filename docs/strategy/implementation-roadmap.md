# Implementation Roadmap

## P0：文档契约与 schema 真值面收口

- 新增 `product-prd.md`、`final-implementation-baseline.md`、`implementation-plan.md`
- 收口 `docs/strategy/` 为唯一规划真值入口
- 固定 `sample-package / sample-index / negative-candidate` 契约
- 将 schema 校验与 answer eval diff 强化并入现有 `check-toolchain`

## P1：飞轮先行

- 跑通样例飞轮骨架
- 先以完全合成 fixture 跑通不可覆盖 canonical index、package 与 candidate descriptor path/hash、contained refs 准入、plumbing 与 SHA-256 exact-diff scoring 记账；输出由仓内有限 shape validator、compiler semantic invariants 和 current canonical authority bytes 重验约束，语义评分、归档 authority 验真和优化候选仍后接
- 固定 `runMode / candidateSourceType / truthExtractionStatus / inputAnswerLeakage`
- 建立 `SampleRunRecord / FeedbackParseResult / OptimizationCandidate / DecisionRecord`
- 先以 hash-bound fixture label 跑通 `SampleRunRecord -> FeedbackParseResult`，再以 canonical case inventory + complete runtime manifest 跑通 fail-closed 分桶 readiness report，并以 clean-revision/log-bound unattested receipt 建立本地诊断面；可信 gate/egress attestation、教师自由文本解析、语义归因与 `OptimizationCandidate` 后接
- 固定视觉证据编译器 schema：`NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`
- 固定 renderer contract schema 和 Typst 主渲染迁移计划
- 补高风险视觉题标疑与 `trusted=false` 回归样例
- 以 VISION-004 的 6 个 raw-byte-bound `synthetic_fixture` 难例按三个 subject-pack 独立统计高风险误放行率、正确标疑召回率、图号/小问绑定准确率和 DecisionRecord replay 通过率；只证明 repo-side contract diagnostics，不升级 gateway/workflow/live authority
- 接入 hash-bound、用户显式触发的 WPF aggregate 附着后立即重验投影
- 接入用户显式选择、raw-byte-bound、source-aware 重验的 WPF 三类 review queue 只读投影；rejected source 使整次投影 fail closed，且不产生审批或 trust 写回
- 接入样例真值面、负样本、反馈链与 Track A
- 以 GEN-003 provider-neutral schema、明确标记的 deterministic `synthetic_fixture`、三个 hash-bound generated candidates 接入飞轮；当前只证明 repo-side contract plumbing，controls 仍未验证且 workflow/live acceptance 后接
- 以 FLYWHEEL-007 将 raw diagnostic bucket 与 release-qualified bucket 分离；synthetic fixture 只保留 `diagnostic_only` provenance，不得贡献非扰动放行门槛
- 以 FLYWHEEL-008 用公开 synthetic teacher text 跑通确定性显式词典解析与 `needs_human_label` 分流；真实教师数据、开放域语义解析和 readiness 判错接入后接
- 以 FLYWHEEL-009 从 canonical synthetic teacher authority 独立统计结构化率、人工分流率和归因分布；该诊断面不接 candidate readiness、qualification 或 eligibility
- 以 FLYWHEEL-010 对同一 canonical synthetic teacher authority 逐项重放 parser，并独立统计 expected-result raw bytes 的 replay pass rate；回放指标不升级 fixture authority，也不接 candidate readiness、qualification 或 eligibility

## P2：双轨视觉与原生输入

- Track B
- Track C validator
- 证据编译运行时
- review 回写
- 图片预处理副链
- 局部高清 crop、多尺度裁剪、坐标轴/表格/刻度/图例抽取
- 先以 VISION-007 的显式 integer `page_pixel` bbox 和 `[1,2]` scales 跑通三个 subject-pack 的公开 synthetic 本地 crop；raw-byte/decoded-pixel hash、path/alias 和 computed fields 全链重验，OCR/layout 语义与自动 region 检测后接
- 再以 VISION-008 从 canonical 2x crop 确定性抽取非语义 line/connected/text-region candidates；固定 OCR 未执行、语义未推断、Track 未集成，真实 OCR/layout/学科图元分类继续后接
- 再以 VISION-009 在同一 canonical 2x crop 上记录 hash-bound RapidOCR observation；允许空结果和错误文本，固定 ground truth 不可用、未验收、需人工复核、语义未推断、Track 未集成，不计算 OCR 准确率
- 再以 VISION-010 对 committed text-region candidates 与 OCR observations 做穷举 axis-aligned geometry measurement；不选择匹配、不复制 OCR 文本，固定 association 未决定、layout/semantic 未推断、Track 未集成
- 再以 VISION-011 从 deterministic renderer 的 source-declared synthetic text/bbox 建立独立 truth authority，按 subject-pack 诊断 exact-text OCR 漏检/误检与 unavailable 分母；不冒充人工 truth、真实 benchmark、OCR acceptance、layout semantics 或 Track B
- 再以 VISION-012 将同一 truth authority 与 VISION-008 heuristic text-region candidates 做 positive-area spatial diagnostic；fully-visible label 一对一 overlap 才计分，partial overlap 只记 unscored，不识别文本、不接 OCR、不推断 layout/association/Track B
- 再以 VISION-013 对公开 synthetic 2x crop 建立 transparent `ai_agent` visual review receipt；只在 `synthetic_fixture_diagnostic` 内视为人工检查等效，保持 `humanReviewed=false`，不接 delivery trust/WPF/live acceptance
- 再以 VISION-014 对 VISION-010 exhaustive measurements 应用双向唯一、正交面积 association policy；原三份 frozen authority 诚实输出两例 unavailable 与一例 unmatched，正向/歧义先以非权威 policy 回归验证
- 再以 VISION-015 新增一份独立准入的公开 synthetic fixture，在不改写前三份 source/crop 与 case request/result authority 的前提下完整重放 VISION-007 至 VISION-014，并仅当 OCR exact truth、text-region coverage、positive-area geometry 与双向唯一 policy 同时成立时形成一个 canonical positive association；renderer-bound truth 合法重签，结果仍不构成真实 association benchmark、layout semantics 或 Track B
- 再以 VISION-016 为该正向 case 增加独立 `measurement_reading` declaration，并只在 VISION-011/012/014 形成精确唯一 evidence triangle 时投影角色和绑定 OCR text；该诊断不推断数值/单位/layout，不创建 FigureUnderstanding、Track B、答案、trust 或 live authority
- 再以 VISION-017 将独立 public synthetic question、ProblemEvidenceBundle 与 VISION-016 projection 编译为固定 review-required 的 `ocr_layout_solver` Track B；quantity/unit 仅来自题干显式 authority
- 再以 VISION-018 重验 VISION-016/017 五份 current bytes，执行七项 deterministic Track C consistency checks；pass 只代表有限一致性，不构成答案批准或 trust
- 再以 VISION-019 实际准入 public synthetic Track A/B/C，正交输出 agreement/conflict、complete/degraded、Track C/source blockers，并复用 canonical DecisionRecord compiler
- 再以 VISION-020 从 current synthetic source 生成透视/旋转/噪声 capture，检测并校正为 hash-bound 560x360 `NormalizedPage`，保持 `regionRefs=[]`
- 再以 VISION-021 从 normalized bytes 自动提出两个 `heuristicOnly` content-block candidates；不复用 semantic `VisualRegion`
- 再以 VISION-022 为两个 proposals 各生成 1x pixel-preserving 与 2x nearest crops；2x 不代表细节恢复或 OCR 改善
- 再以 VISION-023 由独立 public synthetic declaration 将 proposals/crops 投影为有限 reading/scale-baseline VisualRegion；不执行像素分类、通用 axis/table/tick/legend 语义、question binding、Track 或答案生成
- Word 原生 `docx -> NormalizedPage`
- 分桶灰度优化

## P3：研究项

- prompt prose 优化
- 多 VLM ensemble
- Typst adapter、Chromium/Typst parity runner、rollback smoke
- 其他增强能力评估
