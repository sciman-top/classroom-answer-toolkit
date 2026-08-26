# Active Execution Backlog

当前没有 `ready` 的仓库任务。已完成工作由当前代码、测试和 Git 历史证明，不在 active backlog 维护重复 ledger。用户当前明确指令仍可作为独立授权；`.env`、用户原卷和未列入切片的正式交付不得被改动。

## TASK VISION-101 — 有限部件级视觉定位

- status: blocked
- goal: 针对真实错题建立有限、可验证的部件定位和结构化读数。
- unlock_conditions: EVAL-101 verified；真实部件标注 authority 可用；provider endpoint 稳定；四类对象和预算获批。
- forbidden_write_set: 通用 OCR/layout 平台、synthetic 证据链、审批队列、信任聚合系统。
- truth_boundary: 局部读数正确不自动提升整卷 trusted 或 teacher accepted。
- stop_conditions: 任一 unlock 条件缺失即保持 blocked；2026-08-02 audit 仍缺 authority、provider 稳定性和预算。

## TASK WPF-RUNTIME-101 — WPF runtime bundle 评估与实施

- status: blocked（2026-08-25 裁决冻结）
- goal: 评估并（若决策门通过）实施面向非开发者的 runtime bundle 分发。
- unlock_conditions: PRD Decisions 2026-08-25 六项条件全部满足，且 M4 产品化决策门通过。
- forbidden_write_set: 冻结期间不接受教师工作流 UI、复杂界面、runtime packaging、MSIX 相关承诺。
- truth_boundary: repository-coupled companion 的 publish/smoke 结果不构成自包含分发验收。
- stop_conditions: 任一条件缺失保持 blocked；冻结期间仅接受安全、兼容、进程生命周期、诊断与合同修复。

## TASK BASELINE-2026-101 — 2026 回归基线

- status: blocked（待授权输入）
- goal: 在授权输入齐备后决定是否把 2026 广州中考纳入长期回归集合，并按需建立与 2024/2025 同级的 checked-in 基线。
- unlock_conditions: 来源与内部使用权确认；纳入长期回归的方向决策；首次真实运行授权（约 6 次 AI 请求）；质量档与失败重试策略；blind/visual/reference/delivery 证据保留策略。
- forbidden_write_set: 授权缺失期间不得把两份冻结 PDF 称为 baseline 或把入库解释为回归链完成。
- stop_conditions: 任一输入缺失保持 blocked。

## TASK TEACHER-ACCEPT-101 — 首次教师验收记录

- status: blocked（等待指定教师与试卷）
- goal: 按 PRD Decisions 2026-08-25 最小验收协议产出第一份绑定产物哈希的 acceptance record。
- unlock_conditions: 指定教师与试卷；记录查看版本及 manifest/hash 的流程就绪；接受/拒绝/修改意见的记录载体确定。
- forbidden_write_set: 不得用 repo gate、manifest 或渲染成功自动推导 teacher-accepted。
- stop_conditions: 真实验收记录不存在前，交付最高状态只能是 reference-reviewed 或相应机器验证状态。
