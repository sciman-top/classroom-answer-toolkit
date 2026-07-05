# Spec Evolution Adaptation Plan

## 问题定义

各学段各学科规范差异大，而且会持续高频变化。若继续手工维护“源规范 + 完整版 + 调用版 + spec.md + 结构化资产”，漂移几乎不可避免。

## 方案

采用：

- 4 层源规范：平台总则、K12通用、图文定量题通用、物理通用、学段特异
- 自动汇编生成：完整版、调用版、`prompts/<subject-pack>/spec.md`
- 结构化资产与 snapshot 继续分离

## 关键约束

1. 源规范只改 `prompts/specs/platform|commons|subjects`
2. generated 文件禁止手改
3. `humanSpec` 统一指向 compiled 完整版
4. 每次规范变化都要明确影响层与受影响的 subject-pack

## 变更流程

1. 修改源规范
2. 运行 assembler
3. 如有必要同步结构化规则
4. 运行 `validate-assets`
5. 运行对应 subject-pack 回归与视觉校验
