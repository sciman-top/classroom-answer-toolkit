# Implementation Plan

## Execution principles

- 只执行 `execution-backlog.md` 中 `status: ready` 的任务。
- 每个任务必须有允许/禁止 write-set、验证命令、证据输出、回滚和停止条件。
- 当前已有 2024 live workflow 工作树改动先独立收口，不与 25K 行删除混成单个切片。
- 真实交付与 provider 请求始终是显式、边界特定的验收，不由 repo gate 自动触发。

## EPIC-A Truth Alignment

- outcome：PRD、基线、路线图、实施计划、active backlog 和领域词汇一致。
- in_scope：`CONTEXT.md`、Current truth 文档、archive 入口。
- out_of_scope：功能代码删除、live provider。
- acceptance：所有 Current truth 对当前主线、下一里程碑和 acceptance boundary 无冲突。
- verification：Markdown 链接、任务 schema 和关键词扫描。

## EPIC-B Spec Simplification

- outcome：三科组合规范不再要求 frozen 证据对象，最终输出明确为 Markdown-only。
- in_scope：commons 人类真源、assembly 版本、manifest/config/checklist、assembler 生成物、spec-boundary verifier。
- out_of_scope：继续扩写初中物理 100 KB 主体或新增视觉 schema。
- acceptance：active 源规范和 generated spec 不包含禁用对象名；版本与字节一致。
- verification：`assemble:all --check`、`validate:spec-boundary`、`validate:assets`。

## EPIC-C Dead Surface Removal

- outcome：main 只保留当前产品模块。
- in_scope：dormant tools、仅服务旧工具的 schema/fixture、无消费者 DTO、空 Interop。
- out_of_scope：删除历史 evidence 或用户交付。
- acceptance：active workflow、solution、packages、tests 和 verifier 无 frozen 引用。
- verification：引用扫描、build、tests、Core/Full verifier。

## EPIC-D Gate Tiering

- outcome：Fast/Core/Full 提供按风险分层的可解释反馈。
- decisions：test 使用 `--no-build`；asset validation 不重复；Core 只跑受影响 Subject Pack；Full 才跑三科 PDF eval。
- target budgets：当前工作站 Fast <= 60 秒，单 Subject Pack Core <= 120 秒，Full <= 360 秒。
- acceptance：每种模式输出执行/跳过步骤、Subject Pack 和总耗时。

## EPIC-E Test Rebalancing

- outcome：关键合同由实际 CLI/JSON/manifest/ViewModel 行为证明，文本 Contains 只保留少量禁止项守卫。
- desktop boundary：WPF 可见改动必须有 UI Automation 或人工课堂流探针；Playwright 不能证明原生 WPF。
- file cases：中文路径、锁定文件、损坏配置和可移动/同步目录按相关切片补测。

## EPIC-F Real-paper Regression

- outcome：2024/2025 已知错题具有 authority、输入 hash 和 blind/audit/reference 三阶段结果。
- initial cases：2024 Q5/Q16/Q17/Q18；2025 Q8/Q11/Q12/Q17/Q18。
- acceptance：任何阶段失败都单独报告，不用 Reference Review 正确结果覆盖 Blind Candidate 失败。

## EPIC-G Targeted Visual Grounding

- status：blocked。
- unlock：真实部件标注 authority、稳定 provider endpoint、EPIC-F 基准完成。
- scope：滑轮绳段、仪表端子/刻线、刻度尺端点、钩码实例四类有限对象。
- stop：若只能靠新增 synthetic schema、通用视觉平台或更多提示词推进，则停止编码并保留 blocked。

## Gate routing

```text
docs-only -> targeted link/contract verification
local code -> build -> test --no-build -> Fast
subject spec/rules -> build -> test --no-build -> validate:assets -> Core(subject)
shared spec/schema/renderer/release -> build -> test --no-build -> validate:assets -> Full
real workflow claim -> above gates -> explicit relevant real delivery
```
