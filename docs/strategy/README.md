# Strategy Docs

本目录是本仓规划、PRD、终态蓝图、实施规格、路线图、实施计划与执行清单的唯一真值入口。

## authoritative 阅读顺序

1. [product-prd.md](./product-prd.md)
2. [architecture-and-end-state.md](./architecture-and-end-state.md)
3. [final-implementation-baseline.md](./final-implementation-baseline.md)
4. [auto-solving-workstation-final-plan.md](./auto-solving-workstation-final-plan.md)
5. [visual-first-answering-architecture.md](./visual-first-answering-architecture.md)
6. [qq-heavy-visual-chain-transfer-plan.md](./qq-heavy-visual-chain-transfer-plan.md)
7. [ai-gateway-config.md](./ai-gateway-config.md)
8. [typst-primary-renderer-plan.md](./typst-primary-renderer-plan.md)
9. [spec-evolution-adaptation-plan.md](./spec-evolution-adaptation-plan.md)
10. [visual-preprocessing-runtime-plan.md](./visual-preprocessing-runtime-plan.md)
11. [visual-structure-extraction-runtime-plan.md](./visual-structure-extraction-runtime-plan.md)
12. [visual-ocr-observation-runtime-plan.md](./visual-ocr-observation-runtime-plan.md)
13. [visual-spatial-observation-runtime-plan.md](./visual-spatial-observation-runtime-plan.md)
14. [visual-ocr-diagnostic-runtime-plan.md](./visual-ocr-diagnostic-runtime-plan.md)
15. [visual-text-region-diagnostic-runtime-plan.md](./visual-text-region-diagnostic-runtime-plan.md)
16. [visual-machine-review-runtime-plan.md](./visual-machine-review-runtime-plan.md)
17. [visual-ocr-region-association-runtime-plan.md](./visual-ocr-region-association-runtime-plan.md)
18. [visual-positive-association-runtime-plan.md](./visual-positive-association-runtime-plan.md)
19. [visual-positive-association-implementation-plan.md](./visual-positive-association-implementation-plan.md)
20. [visual-semantic-projection-runtime-plan.md](./visual-semantic-projection-runtime-plan.md)
21. [visual-semantic-projection-implementation-plan.md](./visual-semantic-projection-implementation-plan.md)
22. [synthetic-ocr-layout-solver-runtime-plan.md](./synthetic-ocr-layout-solver-runtime-plan.md)
23. [synthetic-track-validator-runtime-plan.md](./synthetic-track-validator-runtime-plan.md)
24. [synthetic-track-orchestration-runtime-plan.md](./synthetic-track-orchestration-runtime-plan.md)
25. [visual-page-normalization-runtime-plan.md](./visual-page-normalization-runtime-plan.md)
26. [visual-region-proposal-runtime-plan.md](./visual-region-proposal-runtime-plan.md)
27. [visual-local-crop-runtime-plan.md](./visual-local-crop-runtime-plan.md)
28. [visual-region-semantics-runtime-plan.md](./visual-region-semantics-runtime-plan.md)
29. [visual-component-semantics-runtime-plan.md](./visual-component-semantics-runtime-plan.md)
30. [visual-scale-lattice-runtime-plan.md](./visual-scale-lattice-runtime-plan.md)
31. [docx-page-normalization-runtime-plan.md](./docx-page-normalization-runtime-plan.md)
32. [provider-answer-generation-runtime-plan.md](./provider-answer-generation-runtime-plan.md)
33. [provider-answer-generation-wpf-workflow-plan.md](./provider-answer-generation-wpf-workflow-plan.md)
33. [implementation-roadmap.md](./implementation-roadmap.md)
34. [implementation-plan.md](./implementation-plan.md)
35. [execution-backlog.md](./execution-backlog.md)
36. [decision-log.md](./decision-log.md)

## 专项文档

- [multi-stage-physics-system-plan.md](./multi-stage-physics-system-plan.md)
- [junior-senior-physics-migration-plan.md](./junior-senior-physics-migration-plan.md)

## 使用规则

1. 新的路线图、实施计划、任务清单、最终版方案，只更新本目录文件。
2. 根目录旧规划文档只保留跳转说明，不再维护正文策略。
3. `prompts/specs/` 是规范真值区，`docs/strategy/` 是规划与执行真值区，二者边界不可混写。
4. AI 或工程师接手前，优先阅读本文件、`product-prd.md`、`final-implementation-baseline.md`、`execution-backlog.md` 与对应 subject-pack 的 compiled 规范。
