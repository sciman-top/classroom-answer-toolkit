# Multi-Stage Physics System Plan

## 目标

本文件只讨论物理双 pack 演进，不承载全局产品、反馈链或视觉飞轮总叙事。

目标是把物理能力拆成：

- `junior-physics-answer`
- `senior-physics-answer`
- `commons/试卷参考答案交付规范-物理通用-v1.0.md`

并验证平台 contract 可以在两套物理包之间复用。

## 文档层

- `subjects/试卷参考答案交付规范-初中物理-源规范-v8.14.md`
- `subjects/试卷参考答案交付规范-高中物理-源规范-v1.0.md`
- 对应 `assemblies/*.json`
- 对应 compiled 完整版与调用版

## 运行时层

第一阶段不引入 `physics-core` 运行时继承层。

原因：

- 当前工具链首先需要证明 `platform-core + 多 subject-pack` 已稳定成立
- 先让初高中物理独立落地，再观察规则和 profile 的重复量

## 何时再评估 physics-core

当以下现象同时出现时，再评估引入 `physics-core`：

- 初高中物理 rule/profile 重复明显拖慢维护
- 复制同步开始成为主要回归来源
- 抽象后不会把物理特异规则错误上移到平台层

## 与其他文档的边界

- 平台终态：见 [architecture-and-end-state.md](./architecture-and-end-state.md)
- 规范治理：见 [spec-evolution-adaptation-plan.md](./spec-evolution-adaptation-plan.md)
- 实施总基线：见 [final-implementation-baseline.md](./final-implementation-baseline.md)
