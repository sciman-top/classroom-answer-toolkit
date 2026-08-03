# Active Execution Backlog

本文件只保留仍影响下一步执行的任务状态。已完成任务的详细 write-set、步骤和停止条件不再进入 active AI 上下文；审计时可读取 Git 基线 `96a38b4:docs/strategy/execution-backlog.md` 和对应 `docs/change-evidence/`。

## Execution protocol

- 用户当前明确指令和本文件中 `status: ready` 的任务可执行；`blocked` 必须满足全部 unlock conditions。
- `verified` 必须有当前 revision 可达的实现、fresh gate 和 evidence；repo、workflow、gateway、teacher acceptance 独立报告。
- 禁止修改 `.env`、用户原卷、未列入当前切片的正式交付和其他用户资产。

## Verified ledger

| Task | State | Current evidence |
| --- | --- | --- |
| PRE-001 live workflow closeout | verified | `docs/change-evidence/20260801-live-2024-answer-workflow.md` |
| SPEC-101 production spec simplification | verified | current compiled assets and spec-boundary gate |
| ARCH-101 dormant tools/schema removal | verified | `docs/change-evidence/20260802-dead-tool-schema-removal.md` |
| ARCH-102 WPF/.NET dead-surface removal | verified | `docs/change-evidence/20260802-wpf-dead-surface-removal.md` |
| GATE-101 Fast/Core/Full tiering | verified | `docs/change-evidence/20260803-gate-governance-weight-audit.md` |
| SDK-101 .NET patch compatibility | verified | current `global.json`, bootstrap contract, build/test gate |
| TEST-101 behavior-test rebalance | verified | 33 xUnit and focused Node behavior suites |
| EVAL-101 2024/2025 real-paper baseline | verified | `docs/change-evidence/20260802-real-paper-regression-baseline.md` |
| GATE-102 eval runtime lifecycle | verified | `docs/change-evidence/20260803-eval-gate-latency-closeout.md` |
| LEAN-101 overdesign complete remediation | verified | `docs/change-evidence/20260803-overdesign-complete-remediation.md` |

## TASK VISION-101 — 有限部件级视觉定位

- status: blocked
- goal: 针对真实错题建立有限、可验证的部件定位和结构化读数。
- unlock_conditions: EVAL-101 verified；真实部件标注 authority 可用；provider endpoint 稳定；四类对象和预算获批。
- forbidden_write_set: 通用 OCR/layout 平台、synthetic 证据链、审批队列、信任聚合系统。
- truth_boundary: 局部读数正确不自动提升整卷 trusted 或 teacher accepted。
- stop_conditions: 任一 unlock 条件缺失即保持 blocked；2026-08-02 audit 仍缺 authority、provider 稳定性和预算。
