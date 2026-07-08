# Implementation Roadmap

## P0：文档契约与 schema 真值面收口

- 新增 `product-prd.md`、`final-implementation-baseline.md`、`implementation-plan.md`
- 收口 `docs/strategy/` 为唯一规划真值入口
- 固定 `sample-package / sample-index / negative-candidate` 契约
- 将 schema 校验与 answer eval diff 强化并入现有 `check-toolchain`

## P1：飞轮先行

- 跑通样例飞轮骨架
- 固定 `runMode / candidateSourceType / truthExtractionStatus / inputAnswerLeakage`
- 建立 `SampleRunRecord / FeedbackParseResult / OptimizationCandidate / DecisionRecord`
- 固定视觉证据编译器 schema：`NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`
- 固定 renderer contract schema 和 Typst 主渲染迁移计划
- 补高风险视觉题标疑与 `trusted=false` 回归样例
- 接入样例真值面、负样本、反馈链与 Track A
- 生成主链后段接入飞轮

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
