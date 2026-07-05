# Junior / Senior Physics Migration Plan

## 目标

将当前初中物理主线从 `physics-answer` 迁移到 `junior-physics-answer`，并建立 `senior-physics-answer` 接入位。

## 迁移范围

- `prompts/physics-answer/ -> prompts/junior-physics-answer/`
- `eval/physics-answer/ -> eval/junior-physics-answer/`
- `assetId`、snapshot、results、README 示例、WPF 默认包名、tests

## 兼容策略

第一阶段保留别名：

- CLI 输入 `physics-answer` 时自动映射到 `junior-physics-answer`
- diagnostics/exporter 输出 canonical name：`junior-physics-answer`

## 验收

1. 初中物理主线能力不回退
2. 新包名成为默认主包
3. 高中物理模板包可编译、可校验、可扩展
