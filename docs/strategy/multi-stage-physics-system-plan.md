# Multi-Stage Physics System Plan

## 总体策略

物理不再只作为一个 subject-pack 存在，而是拆成：

- `junior-physics-answer`
- `senior-physics-answer`

同时保留：

- `commons/试卷参考答案交付规范-物理通用-v1.0.md`

## 文档层

- `subjects/试卷参考答案交付规范-初中物理-源规范-v8.14.md`
- `subjects/试卷参考答案交付规范-高中物理-源规范-v1.0.md`
- 两者分别汇编成 compiled 完整版与调用版

## 运行时层

第一阶段不引入 `physics-core` 运行时继承层。

原因：

- 当前工具链只稳定支持 `platform-core + 一个 subject-pack`
- 先让初高中物理独立落地，再观察重复量

## 后续演进

当初高中物理运行时规则重复已明显拖慢维护时，再评估是否引入 `physics-core`。
