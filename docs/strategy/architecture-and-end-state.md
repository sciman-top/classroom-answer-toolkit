# Architecture And End State

## 目标

本仓终态不是“单份提示词仓库”，而是：

- Windows 桌面壳
- 本地优先生成引擎
- subject-pack 体系
- 规则快照体系
- 视觉证据与复核门禁

## 分层

1. 桌面层：WPF、Generic Host、MVVM，负责 orchestration、diagnostics、review、delivery。
2. 平台核心层：规则、profile、snapshot、delivery manifest、workspace diagnostics 等跨学科 contract。
3. 学科包层：按 subject-pack 承载学段学科规则、评测、profile override 和 compiled spec。
4. 工具实现层：OCR、规则编译、渲染、review、作图题辅助与交付。

## 技术栈

- 桌面壳：WPF + .NET 10 + CommunityToolkit.Mvvm + Generic Host
- 渲染：Markdown-It + KaTeX + Playwright/Chromium
- OCR/布局：本地 OCR 路径 + 结构化布局抽取
- 规则协议：JSON + JSON Schema + compiled snapshot
- 人类规范：源规范 + 汇编生成物

## 终态原则

1. 平台核心无学科。
2. 运行时真相是 snapshot，不是大规格 Markdown。
3. 对外可转发真相是 compiled human spec。
4. 视觉风险必须可比对、可复核、可回放。
