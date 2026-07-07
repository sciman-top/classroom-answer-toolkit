# Junior / Senior Physics Migration Plan

## 目标

将旧的单一物理主线明确收敛为：

- `junior-physics-answer`：当前主线
- `senior-physics-answer`：模板包与后续接入位

同时保留对旧包名 `physics-answer` 的短期兼容。

## 范围

- `prompts/physics-answer/ -> prompts/junior-physics-answer/`
- `eval/physics-answer/ -> eval/junior-physics-answer/`
- `assetId`、snapshot、results、README 示例、WPF 默认包名、tests

## 兼容策略

第一阶段保留别名：

- CLI 输入 `physics-answer` 时自动映射到 `junior-physics-answer`
- diagnostics / exporter 输出 canonical name：`junior-physics-answer`

## 当前边界

- 本文件只讨论 pack 迁移与兼容别名
- 不讨论飞轮、反馈链、视觉双轨或 schema 真值面

## 验收

1. 初中物理主线能力不回退
2. 新包名成为默认主包
3. 高中物理模板包可编译、可校验、可扩展
