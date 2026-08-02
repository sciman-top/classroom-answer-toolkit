# Spec Evolution Adaptation Plan

## 1. 目标

本文件承载“高频变化规范下的最佳终态”，只讨论规范治理，不讨论产品交互、飞轮队列或视觉复核 UI。

目标是让各学段、各学科、各 subject-pack 的规范变化形成一条：

`改源规范 -> 自动汇编 -> 影响分析 -> 回归验证 -> 渐进生效 -> 可回滚`

的稳定链路。

## 2. 真值边界

- `prompts/specs/`：人类规范真值区
- `docs/strategy/`：规划与执行真值区
- `compiled/`：自动生成的人类可转发规范
- `snapshot`：运行时真相

文档边界要求：

- 规范正文、规则口径、层级归属写在 `prompts/specs/`
- 规范治理流程、兼容窗口、影响分析、回滚要求写在 `docs/strategy/`

## 3. 最佳终态结构

### 规范分层

固定分层为：

1. `platform/`
2. `commons/`
3. `subjects/`
4. `compiled/`
5. `assemblies/`

### 版本与标识

- 所有 schema 统一补 `$id`
- 新增 compatibility 语义
- 每个 assembly 必须显式声明输出版本
- 每个 `subject-pack` 必须能追溯到对应的 `specVersion / snapshotVersion`
- commons 或 platform 行为变化必须提升所有受影响 assembly 的组合输出版本；不要求未变化的 subject source 伪装成新版本

### 汇编与编排

`assemblies/*.json` 从“汇编清单”演进为“编排清单”，显式表达：

- base
- overlay
- mergeStrategy
- overrides

## 4. 关键约束

1. 源规范只改 `prompts/specs/platform|commons|subjects`
2. `compiled/` 与 `prompts/<subject-pack>/spec.md` 一律视为 generated artifacts，禁止手改
3. `humanSpec` 一律指向 compiled 完整版
4. 结构化资产与 `snapshot` 分离，不互相替代
5. 每次规范变化都必须明确受影响层和受影响 `subject-pack`
6. active spec 不得引用已由最终实施基线冻结的内部对象、工具或工作流
7. 模型最终输出合同必须明确区分答案 Markdown 与仓内 manifest/diagnostics

## 5. 治理机制

### Schema 治理

- 所有 schema 有 `$id`
- compatibility 有明确定义
- 新增 schema 必须接入 `validate:assets`
- frozen 模块 schema 在消费者清理后必须从 active schema root 删除，不以“可能未来使用”为由永久保留

### 影响分析

`tools/spec-assembler/` 与 `tools/rule-compiler/` 应补足：

- diff 输出
- 受影响 `subject-pack` 列表
- breaking/minor/patch 级别判断

### override 语义

override precedence 与冲突裁决规则必须写清，并与 `assemblies/` 及运行时保持一致。

### 回归与回滚

规范变化后至少执行：

1. assembler
2. `validate:spec-boundary`
3. `validate-assets`
4. 对应 `subject-pack` 的 Core verifier
5. shared commons/platform 或跨学科变化执行 Full verifier

若回归失败，允许：

- 回退源规范
- 回退 assembly 版本
- 回退结构化规则或 profile 变更

## 6. 变更流程

1. 修改源规范
2. 提升受影响 assembly 的组合输出版本
3. 运行 assembler，不手改 generated artifacts
4. 必要时同步结构化规则、manifest、config 和 acceptance checklist
5. 运行 `validate:spec-boundary` 与 `validate-assets`
6. 运行对应 Core 或 Full verifier
7. 记录影响分析、truth boundary 与回滚点

## 7. 不做项

- 不把样例飞轮、反馈队列或视觉 review 规则写进本文件
- 不把产品 PRD 或执行任务清单混入本文件
