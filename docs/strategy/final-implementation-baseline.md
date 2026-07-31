# Final Implementation Baseline

## 唯一主链

```text
SourcePdf -> ordered page images -> AI answer Markdown -> optional reference review -> validator -> PDF -> review images -> manifest
```

主链入口为 `scripts/run-live-answer-workflow.ps1`，AI 调用由 `tools/ai-gateway/answer-request.mjs` 承担，校验与排版由 `tools/latex-renderer/` 承担。

## 真值面

- 提示词人类真源：`prompts/specs/platform|commons|subjects/`。
- 生成提示词：`prompts/specs/compiled/` 与 `prompts/<subject-pack>/spec.md`，禁止手改。
- 规则真源：`prompts/platform-core/` 与 `prompts/<subject-pack>/rules|profiles/`。
- 运行快照：`.snapshot-cache/`。
- 真实交付：用户指定的输出目录；manifest 绑定本次 Markdown、PDF、snapshot 和 review。

## 保留模块

- `tools/spec-assembler`
- `tools/rule-compiler`
- `tools/ai-gateway`
- `tools/latex-renderer`
- `tools/ocr`，仅作为明确需要时的辅助能力
- 最小 WPF 桌面壳层

## 已移除旁支

2026-07-31 起，不再维护 synthetic 视觉观察/诊断/语义投影链、visual-evidence 聚合信任链、sample flywheel、review queue、synthetic answer generator 和实验 answer-graphics CLI。这些模块没有进入真实 2025 答案主链，却显著增加 schema、eval、WPF 和门禁复杂度。

历史 change-evidence 和 decision log 保留为审计记录，不代表当前产品承诺。

## 质量边界

- 提示词版本正确不等于答案正确。
- AI 请求成功不等于整卷题号覆盖和视觉读图正确。
- Markdown/PDF 校验通过不等于语义正确。
- 参考答案或教师复核完成后，才可把校正版本作为正式参考答案交付。

## 下一里程碑

在当前主链中加入可选 `ReferencePdf`：保留盲答候选，调用 AI 对照原卷与权威答案逐题复核，输出校正 Markdown 和差异报告；重点覆盖选择题、仪表读数、电路接线和多小问遗漏。
