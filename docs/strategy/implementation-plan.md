# Implementation Plan

## P0 已完成：真实主链

- v8.14 完整提示词作为初中物理运行规范。
- 原卷 PDF 渲染为有序页面图。
- AI gateway 生成完整答案 Markdown。
- validator、PDF、review 页图和 delivery manifest 交付。
- 中文输出路径稳定性修复。
- 2025 广州中考真实运行与人工校正交付。

## P1 当前：参考答案复核

- `run-live-answer-workflow.ps1` 接受可选 `ReferencePdf`。
- 盲答候选单独保留，避免复核覆盖原始证据。
- 原卷、候选和参考答案共同进入复核请求。
- 输出完整校正 Markdown，而不是只输出差异摘要。
- 生成逐题差异报告；无法判定项显式标记。
- 校正结果重新执行 validator 和 renderer。

## P2：视觉题精度

- 对仪表、电路、光路、受力和实验装置题生成局部高清 crop。
- 将 crop 与明确题号一起送入复核，而不是建设通用 OCR/layout 平台。
- 增加 2025 错题的固定回归：8、11、12、17、18 题。

## P3：批量年份

- 在 2025 闭环稳定后，按同一命令逐年运行 2015-2024。
- 每年只保存任务输入引用、盲答候选、差异报告和最终交付，不建设题库索引。

## 每个切片的门禁

`build -> test -> validate:assets -> check-toolchain -> relevant real delivery`
