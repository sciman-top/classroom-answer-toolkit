# Prompts Specs

`prompts/specs/` 是本仓人类可读规范的唯一真值区。

## 目录职责

- `platform/`：只放全平台、全学段、全学科共性规则。
- `commons/`：只放跨多个学科或多个学段可复用的规则。
- `subjects/`：只放学段学科特异性源规范，以及必要的调用版源文件。
- `compiled/`：只放自动汇编产物，禁止手改。
- `assemblies/`：汇编真值，决定完整版、调用版与 `prompts/<subject-pack>/spec.md` 如何生成。

## 使用规则

1. 修改规范时，先改 `platform/`、`commons/` 或 `subjects/` 下的源文件。
2. 运行汇编工具生成 `compiled/` 与对应 subject-pack 下的 `spec.md`。
3. `compiled/` 下文件与 `prompts/<subject-pack>/spec.md` 视为 generated artifacts，不直接手改。
4. 新增学段或学科时，先补 `subjects/` 与 `assemblies/`；只有确认可复用时才上移到 `commons/`。
5. `subject-pack` 的 `humanSpec` 一律指向 `compiled/` 下的完整版，不指向源规范。
6. schema、compatibility、impact analysis、回归窗口与回滚要求的执行面统一看 [docs/strategy/spec-evolution-adaptation-plan.md](../../docs/strategy/spec-evolution-adaptation-plan.md)。

## 当前分层

当前固定分层为：

1. `platform/`：平台总则
2. `commons/`：`K12通用`、`图文定量题通用`、`物理通用`
3. `subjects/`：初中物理、高中物理、初中数学实验支架
4. `compiled/`：完整版、调用版

## 维护边界

- `platform/` 不承载学科知识口径。
- `commons/图文定量题通用` 不假定“这一定是物理题”，只放图文定量题共性。
- `commons/物理通用` 只放跨初高中物理都适用的规则。
- `subjects/` 允许在 bootstrap 阶段暂存少量尚未上移的通用内容，但后续应逐步抽离。
- schema 与策略类规划写在 `docs/strategy/`，不写在源规范正文里。
- 源规范只改 `platform/`、`commons/`、`subjects/`；generated artifacts 禁手改。
- 高频变化规范下的影响分析、兼容窗口与回归要求以 strategy 文档为准。
