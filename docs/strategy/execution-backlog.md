# Active Execution Backlog

当前没有 `ready` 的仓库任务。已完成工作由当前代码、测试和 Git 历史证明，不在 active backlog 维护重复 ledger。用户当前明确指令仍可作为独立授权；`.env`、用户原卷和未列入切片的正式交付不得被改动。

## TASK VISION-101 — 有限部件级视觉定位

- status: blocked
- goal: 针对真实错题建立有限、可验证的部件定位和结构化读数。
- unlock_conditions: EVAL-101 verified；真实部件标注 authority 可用；provider endpoint 稳定；四类对象和预算获批。
- forbidden_write_set: 通用 OCR/layout 平台、synthetic 证据链、审批队列、信任聚合系统。
- truth_boundary: 局部读数正确不自动提升整卷 trusted 或 teacher accepted。
- stop_conditions: 任一 unlock 条件缺失即保持 blocked；2026-08-02 audit 仍缺 authority、provider 稳定性和预算。

## TASK WPF-RUNTIME-101 — WPF runtime bundle 实施

- status: in_progress（2026-08-31 用户明确授权）
- goal: 实施面向普通 Windows 用户的安装版和绿色便携版，两者复用同一自包含 runtime bundle。
- current_slice: runtime root 解析、包内 Node、Inno Setup、portable ZIP、安装程序更新、版本化交付目录与本地验收。
- forbidden_write_set: 不扩建教师工作流 UI，不把 preview ZIP 改名冒充安装版，不弱化 Authenticode 或普通用户验收门。
- truth_boundary: repository-coupled publish/smoke、本地 unsigned candidate、签名身份、GitHub stable 发布和代表性非开发者验收分别留证，不得互相外推。
- stop_conditions: 本地工程门失败则修复；无有效签名身份时停在 verified unsigned candidate，不发布 stable。

## TASK BASELINE-2026-101 — 2026 回归基线

- status: blocked（待授权输入）
- goal: 在授权输入齐备后决定是否把 2026 广州中考纳入长期回归集合，并按需建立与 2024/2025 同级的 checked-in 基线。
- unlock_conditions: 来源与内部使用权确认；纳入长期回归的方向决策；首次真实运行授权（约 6 次 AI 请求）；质量档与失败重试策略；blind/visual/reference/delivery 证据保留策略。
- forbidden_write_set: 授权缺失期间不得把两份冻结 PDF 称为 baseline 或把入库解释为回归链完成。
- stop_conditions: 任一输入缺失保持 blocked。
