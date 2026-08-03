# Strategy Index

本目录只用少数当前真值文件指导产品和编码；历史计划、change-evidence 与 decision log 只用于追溯，不能自动生成新任务。

## Current truth

按以下顺序阅读：

1. [product-prd.md](./product-prd.md)：用户目标、用户流程、产品验收和非目标。
2. [final-implementation-baseline.md](./final-implementation-baseline.md)：唯一主链、模块边界和质量不变量。
3. [architecture-and-end-state.md](./architecture-and-end-state.md)：当前架构与目标结构。
4. [implementation-roadmap.md](./implementation-roadmap.md)：阶段结果、状态、证据和剩余缺口。
5. [implementation-plan.md](./implementation-plan.md)：Epic、切片顺序、依赖和门禁策略。
6. [execution-backlog.md](./execution-backlog.md)：唯一 active task 真源。
7. [spec-evolution-adaptation-plan.md](./spec-evolution-adaptation-plan.md)：spec 版本、兼容、生成和回滚规则。

## Supporting decisions

- [product-core-simplification.md](./product-core-simplification.md)：为什么冻结并清理旧 synthetic/review/flywheel 链。
- [ai-gateway-config.md](./ai-gateway-config.md)：provider 配置和显式云出网边界。
- [decision-log.md](./decision-log.md)：历史决策记录，不代表任务仍 active。

## Archive and evidence

- `docs/change-evidence/`：过去切片的命令、结果与边界，不定义未来范围。
- `docs/archive/strategy-plans/`：已退出当前阅读链的历史方案；仅供追溯，AI 不得从中生成任务或恢复已删除模块。
- 本目录仅保留 `Current truth` 中的两份 active `*-plan.md`；任何历史计划回迁都必须先形成 active backlog 条目和范围批准。
- 旧版 62-task backlog 可从 Git 基线 `6cf3904` 读取：`git show 6cf3904:docs/strategy/execution-backlog.md`。

## AI execution rule

AI 只能执行 `execution-backlog.md` 中 `status: ready` 的任务，并遵守其 `allowed_write_set`、`forbidden_write_set`、依赖、验证和停止条件。历史文档中的 `todo`、`next` 或 `done_definition` 不构成执行授权。
