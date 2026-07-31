# Strategy Docs

本目录是本仓产品、实施与证据策略真值入口。当前以课堂答案交付为中心，不把 synthetic
诊断、review 治理或未来研究路线当作默认产品能力。

## 当前只读这些

1. [product-prd.md](./product-prd.md)：产品范围与非承诺。
2. [product-core-simplification.md](./product-core-simplification.md)：当前核心、冻结面与重新启用条件。
3. [final-implementation-baseline.md](./final-implementation-baseline.md)：仍有效的合同和 fail-closed 边界。
4. [implementation-roadmap.md](./implementation-roadmap.md)：按真实验证驱动的下一步。
5. [implementation-plan.md](./implementation-plan.md)：实施顺序和验证标准。
6. [execution-backlog.md](./execution-backlog.md)：任务状态与明确 blocker。
7. [provider-answer-generation-wpf-workflow-plan.md](./provider-answer-generation-wpf-workflow-plan.md)：当前新主链的受控 WPF 合同。

## 核心产品路径

`公开/已脱敏题目 → 显式 provider generation → answer.md → PDF/review → 人工判断`

默认 WPF 只承载这条路径及工具链恢复。云外发、交付和人工判断必须分别显式触发；默认
`pending_review / trusted=false` 不会因本地测试或 synthetic evidence 自动升级。

## 冻结的支持面

以下文档与工具保留为兼容、回归、取证或未来实验依据，但不进入默认阅读顺序、教师界面或
近期开发承诺：视觉 synthetic runtime plans、aggregate/DecisionRecord 写操作、review queue
投影、优化飞轮、Typst、复杂 OCR/Word 重建和多 VLM 研究。重新启用必须先满足
`product-core-simplification.md` 中的真实使用证据条件。

冻结索引仍保留：[ai-gateway-config.md](./ai-gateway-config.md)、
[auto-solving-workstation-final-plan.md](./auto-solving-workstation-final-plan.md)、
[typst-primary-renderer-plan.md](./typst-primary-renderer-plan.md)；它们不是当前默认路线。

## 使用规则

1. 新的核心产品改动必须更新本文件列出的核心真值面和 `docs/change-evidence/`。
2. `prompts/specs/` 是规范真值区，`docs/strategy/` 是产品与执行真值区；生成物仍不得手改。
3. 不因 schema、synthetic fixture、repo gate 或 pending review 宣称 gateway verified、workstation accepted 或 live accepted。
4. 恢复冻结路线前，先记录真实用户需求、输入数据、owner、验收指标和回滚边界。
