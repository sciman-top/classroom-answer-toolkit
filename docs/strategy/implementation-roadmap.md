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
- Word 原生 `docx -> NormalizedPage`
- 分桶灰度优化

## P3：研究项

- prompt prose 优化
- 多 VLM ensemble
- Typst adapter、Chromium/Typst parity runner、rollback smoke
- 其他增强能力评估
