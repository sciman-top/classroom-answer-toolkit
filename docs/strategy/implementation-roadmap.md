# Implementation Roadmap

状态含义：`repo` 只表示仓内实现与门禁；`live` 表示真实 provider/试卷运行；`accepted` 只表示教师对指定交付物的验收。

| 阶段 | 结果 | Repo 状态 | Live/acceptance 状态 | 证据与剩余缺口 |
|---|---|---|---|---|
| R1 | Source Exam -> Blind Candidate Markdown | integrated | 2024/2025 live | 候选仍有语义错误，不可信 |
| R2 | Markdown -> validator -> PDF/review/manifest | integrated | 2024/2025 live | renderer 交付已证明，不代表答案正确 |
| R3 | Reference Review 与完整校正 Markdown | integrated | 2024/2025 reference-reviewed | teacher accepted 仍未记录 |
| R4 | 默认题目级 4x 重叠 Visual Audit | current-worktree integrated | 2024 live, not accepted | Q16-Q18 盲测仍失败；全量 50 图请求超时 |
| R5 | 规划/spec/verifier 真值收口 | verified | repo verified | 生产 spec、终态基线与 active backlog 已对齐 |
| R6 | frozen 实现物理清理 | verified | N/A | 旧工具、专属 schema/eval、死 DTO、未使用 diagnostics 和空 Interop 已删除 |
| R7 | Fast/Core/Full 门禁分层 | verified | N/A | 三模式按影响范围执行；合同只跑一次；eval 复用 snapshot/browser；Full 保留三科与 PDF smoke |
| R8 | 2024/2025 真实错题基准 | verified | existing live artifacts hash-bound | 2024 三阶段已记录；2025 audit 明确 not_run；teacher accepted 均为 false |
| R9 | 有限部件级视觉定位 | blocked | provider/authority open | 需要真实标注、稳定 endpoint 和 R8 基准 |
| R10 | 2015-2023 逐年真实回归 | later | open | R8/R9 稳定后推进 |

任何不直接服务以上结果的题库治理、synthetic 诊断平台、优化飞轮或审批系统不进入 active roadmap。
