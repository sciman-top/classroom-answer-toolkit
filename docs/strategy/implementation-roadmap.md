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
- 接入 hash-bound、用户显式触发的 WPF aggregate 附着后立即重验投影
- 接入样例真值面、负样本、反馈链与 Track A
- 以 GEN-003 provider-neutral schema、明确标记的 deterministic `synthetic_fixture`、三个 hash-bound generated candidates 接入飞轮；当前只证明 repo-side contract plumbing，controls 仍未验证且 workflow/live acceptance 后接
- 以 FLYWHEEL-007 将 raw diagnostic bucket 与 release-qualified bucket 分离；synthetic fixture 只保留 `diagnostic_only` provenance，不得贡献非扰动放行门槛

## P2：双轨视觉与原生输入

- Track B
- Track C validator
- 证据编译运行时
- review 回写
- 图片预处理副链
- 局部高清 crop、多尺度裁剪、坐标轴/表格/刻度/图例抽取
- Word 原生 `docx -> NormalizedPage`
- 分桶灰度优化

## P3：研究项

- prompt prose 优化
- 多 VLM ensemble
- Typst adapter、Chromium/Typst parity runner、rollback smoke
- 其他增强能力评估
