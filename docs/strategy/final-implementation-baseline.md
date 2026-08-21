# Final Implementation Baseline

## Canonical workflow

```text
SourceExam
  -> ordered page images
  -> Blind Candidate Markdown
  -> Visual Audit
  -> optional Reference Review
  -> validator
  -> PDF/review images
  -> delivery-specific Snapshot + Delivery Manifest 1.1
  -> Workflow Run Receipt
  -> optional Teacher Acceptance
```

主链入口为 `scripts/run-live-answer-workflow.ps1`；AI 调用由 `tools/ai-gateway/answer-request.mjs` 承担；校验、排版、review 和 manifest 由 `tools/latex-renderer/` 承担。

## Truth surfaces

- 产品和执行真值：`docs/strategy/` 中 Strategy Index 列出的 Current truth。
- 提示词人类真源：`prompts/specs/platform|commons|subjects/`。
- 汇编真值：`prompts/specs/assemblies/`。
- 生成提示词：`prompts/specs/compiled/` 与 `prompts/<subject-pack>/spec.md`，禁止手改。
- 规则真源：`prompts/platform-core/` 与 `prompts/<subject-pack>/rules|profiles/`。
- 编译缓存快照：`.snapshot-cache/`；它可被后续编译替换，不能直接充当长期交付证据。
- 真实交付：用户指定输出目录；每个 PDF 同目录保留交付专属 snapshot，manifest 1.1 绑定输入 Markdown、PDF、snapshot 和当前 review 文件集合的字节数与 SHA-256。
- 工作流执行证据：各 AI 阶段独立 `*.summary.json`，最终 `<原卷名>.workflow-run.json` 记录输入 hash、阶段终态、当前产物及失败诊断目录。

## Retained modules

- `tools/spec-assembler`
- `tools/rule-compiler`
- `tools/ai-gateway`
- `tools/latex-renderer`
- renderer 内的 Tesseract.js OCR，仅作为明确请求时的辅助能力
- App/Domain/Infra 三程序集的最小 WPF 桌面壳层

## Frozen and removal targets

以下能力不属于当前产品主链：synthetic 视觉观察/诊断/语义投影链、visual-evidence 聚合信任链、sample flywheel、review queue、synthetic answer generator、image-generation provider lane、Typst migration contract 和实验 answer-graphics CLI。

- 不得新增对这些模块的 schema、WPF 控件、gate 或 roadmap 承诺。
- frozen 工具、专属 schema 和 fixture 已由 ARCH-101 从 active tree 删除；WPF DTO 与空项目由独立 ARCH-102 切片处理。
- Git 历史和 change-evidence 承担追溯；不把旧代码、临时渲染产物、`.answer-graphics/` 或根目录旧提示词复制到 active tree。

## Invariants

- active 生产 spec 不得要求模型生成已冻结的内部证据对象。
- 最终模型输出必须是完整答案 Markdown，不输出内部检查表、JSON 或分析过程。
- Blind Candidate、Visual Audit、Reference-reviewed Delivery 和 Teacher Accepted 是不同状态。
- prompt 版本正确不等于答案正确；AI 请求成功不等于题号覆盖或读图正确；PDF 成功不等于语义正确。
- Reference Review 完成后才可称 Reference-reviewed Delivery；只有教师实际验收后才可称 Teacher Accepted。
- WPF 不复制 Node 业务逻辑，不因缺少历史 review/trust 对象而扩建领域模型。
- WPF 的 deliver 成功必须核对 manifest 的 input/output、subject-pack、profile 和本次生成时间；不能接受另一份 Markdown 或旧回执留下的产物。
- 发布 WPF 仍是 repository-coupled companion；隔离 smoke 只证明启动和缺仓 fail-closed。没有可写、版本化 runtime bundle 前不得生成或宣称自包含 MSIX。
- 验证按变更面路由：C# 用 build+xUnit，gateway/renderer 用 focused Node 测试，subject spec/rules 用 Core；shared spec/schema、跨学科或 release 才用 Full。
- Full 的通用 renderer/layout 合同由主产品包运行一次；其他 subject-pack 必须保留独立 snapshot 和学科特异 sentinel，不复制同一输入与视觉基准。

## Compatibility and versioning

- 人类 spec 行为变化必须提升组合规范版本并重新汇编 generated artifacts。
- manifest、runtime config、compiled spec、mirrored spec 和 acceptance checklist 的版本口径必须一致。
- delivery manifest `1.0` 保持读取兼容；新交付只写 `1.1`，并由运行 validator 强制 integrity 字段和实际文件哈希。
- 删除 frozen schema/tool 前先证明 active workflow、tests、package scripts 和 verifier 无消费者。
- 回滚只恢复本切片的 spec、工具、测试和文档，不覆盖用户原卷、`.env` 或真实交付目录。

## Milestones

1. `M0 truth-alignment`：PRD、基线、路线图、计划、backlog、spec 和 verifier 一致。
2. `M1 dead-surface-removal`（verified）：退出主链的工具、专属 schema/eval、死 DTO、未使用 diagnostics 和空项目已删除。
3. `M2 gate-tiering`（verified）：Focused/Core/Full 已分层、去重并解除 patch SDK 摩擦。
4. `M3 real-paper-regression`（verified）：2024/2025 真实错题已绑定 authority、输入/产物 hash 和独立阶段结果。
5. `M4 targeted-visual-grounding`：在真实标注和稳定 provider 前提下接入有限部件定位。
6. `M5 historical-rollout`：按同一主链推进 2015-2023 真实回归。
