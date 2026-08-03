# Current Decision Log

本文件只保留仍约束当前产品的架构决策。D-001 至 D-034 已归档到
[`docs/archive/decision-log-legacy.md`](../archive/decision-log-legacy.md)。

## D-035 回归答案生成与排版主链

- 日期：2026-07-31
- 决定：项目不再建设题库治理、sample flywheel、synthetic visual diagnostics、visual-evidence aggregate trust、review queue、synthetic answer generator 或实验 answer-graphics CLI。
- 保留：v8.15 subject-pack、AI gateway、rule compiler、latex renderer、真实 eval、最小 WPF 和历史审计记录。
- 边界：候选、视觉审计、参考复核和教师验收继续独立表达。

## D-036 active tree 与回归所有权收敛

- 日期：2026-08-03
- 决定：可复现的 `tmp/`、退役 `.answer-graphics/` 和旧根提示词不再进入 Git；真实错题只在 `eval/real-paper/` 与正式交付中保留最小、可审计证据。
- 回归：初中物理作为主产品包承担共享 renderer/layout 回归；高中物理只保留 snapshot、视觉 smoke 和学科特异 validator sentinel；数学保留独有图表和推导回归。
- WPF：编排接口归入 Domain，编排实现与 DI 归入 App，生产程序集收敛为 App、Domain、Infra。
- 原因：删除没有独立消费者、独立变化率或独立发布价值的资产、测试和程序集边界，同时保留真实主链保护。
- 回滚：各切片独立回滚；不得通过恢复 frozen 模块或临时渲染目录回滚。
