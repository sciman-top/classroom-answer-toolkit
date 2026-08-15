# Strategy Index

当前产品真值只保留四个入口，按顺序读取：

1. [product-prd.md](./product-prd.md)：目标、非目标、用户流程和验收边界。
2. [final-implementation-baseline.md](./final-implementation-baseline.md)：唯一主链、模块、兼容与验证映射。
3. [ai-gateway-config.md](./ai-gateway-config.md)：provider 配置和显式云出网边界。
4. [execution-backlog.md](./execution-backlog.md)：唯一未闭合任务面。

历史计划、ADR、已完成任务和普通变更证据由 Git 历史追溯，不留在 active tree，也不得自动生成新任务。`docs/change-evidence/` 只保留真实试卷/live/manual/external acceptance 或有期限 waiver 的精确锚点。

AI 只执行用户当前明确指令或 backlog 中 `status: ready` 的任务；blocked 条目不因历史文档出现 `todo`、`next` 或 `done_definition` 而解锁。
