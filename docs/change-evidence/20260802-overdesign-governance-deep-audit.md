# 2026-08-02 过度设计、门禁与治理深审收口

## 审查结论

当前仓库曾出现明显过度设计和治理过重，主要不是单个函数的复杂度问题，而是产品承诺之外形成了第二套平台：synthetic 视觉预处理/语义投影、Track A/B/C、DecisionRecord/聚合信任、review queue、sample flywheel、优化 readiness、通用 DOCX 重建，以及大量只互相消费的 schema/eval fixture。它们增加了维护面和门禁时间，却没有证明 2024/2025 真实错题的盲答正确率、教师接受率或课堂效率得到改善。

本轮已把 active product 收敛为：

`明确路径的试卷 -> 显式 provider 生成 -> answer.md -> 规则校验 -> PDF/review/manifest -> 参考答案或教师判断`

结论不是“治理全部删除”，而是只保留能保护当前主链、兼容边界和真实回归的最小治理。

## 发现与处置矩阵

| 问题 | 当前证据 | 决策 | 已落盘处置 | 防复发条件 |
| --- | --- | --- | --- | --- |
| 通用视觉理解平台早于真实需求 | 多个视觉预处理、OCR 关联、空间观察、结构提取、语义投影工具只由 synthetic fixture 和相邻工具消费 | 删除 | 删除 dormant 工具、专属 eval 与无消费者 schema；Git 历史保留 | `VISION-101` 只有真实部件标注 authority、稳定 endpoint、四类对象和预算全部具备才解锁 |
| 信任/审批系统超出单机教师工具形态 | DecisionRecord、delivery aggregate、review queue 和生命周期写回没有当前多用户 owner 或持久化工作流 | 删除并冻结 | 删除工具、DTO、诊断字段和 package 入口；保留 manifest 的必要兼容读取 | 重新引入必须先证明真实重复流程、actor、持久化位置、回滚和验收指标 |
| synthetic 优化飞轮替代真实效果证明 | readiness、teacher-feedback parsing 和 synthetic answer generation 可自洽通过，但不能证明真实卷改进 | 删除 | 删除 sample-flywheel、answer-generator 及其 eval；建立 2024/2025 hash-bound real-paper baseline | 后续优化必须报告 blind/audit/reference 各阶段，不允许 reference 结果覆盖 blind 失败 |
| schema 和 verifier 范围膨胀 | 原资产校验覆盖 99 个 schema，多数仅服务 dormant 平台 | 缩减 | schema 收敛为 12 个当前主链或兼容消费者可达文件 | `validate:assets` 从 retained consumers 出发；不得仅因“以后可能需要”增加 schema |
| 生产 spec 泄漏内部治理对象 | 三科 prompt 曾要求输出证据/决策类对象，增加 token 和失败面 | 移除 | common spec v1.1，三科版本升至 v8.15/v1.1/v0.2；新增 fail-closed spec-boundary verifier | 8 个 frozen terms 在 source、compiled 和 mirrored specs 中均必须缺席 |
| 门禁重复且不按风险路由 | 日常修改也会重复跑三科 snapshot/eval 和资产校验 | 分层 | `check-toolchain.ps1` 提供 Fast/Core/Full、Subject Pack 路由、executed/skipped/elapsed 摘要 | shared spec/schema/renderer/release 必跑 Full；局部 subject 改动可跑 Core；不得降低断言换时间 |
| 测试过度依赖源码字符串 | 重命名可能造成无行为变化失败，真实 CLI 行为反而覆盖不足 | 再平衡 | 高价值路径改为 CLI/JSON/manifest/ViewModel 行为测试，只保留少量禁止项扫描 | 新测试优先证明输出、退出码、manifest 或 ViewModel 状态；可见 WPF 行为另需 UI/人工证据 |
| 规划文档可生成多套“下一步” | 大量历史 `*-plan.md` 与旧 62-task backlog 容易被 AI 当成 active | 单一真源 | `docs/strategy/README.md` 固定 Current truth；`execution-backlog.md` 是唯一 active task 真源；旧计划默认 historical | AI 只执行 `status: ready`，并遵守 write-set、依赖、stop conditions 和 truth boundary |

## 实际缩减

- 最终候选提交相对 Git 基线：524 个文件变化，54,510 行删除、2,479 行新增（含 Git rename detection 后的统计）。
- dormant cleanup evidence 记录：24 个 frozen tool 目录、23 个专属 eval/fixture 目录、87 个无消费者 schema 退出 tracked 产品面。
- 当前 schema 合同为 12 个；当前解决方案 build 仅含 Domain/Application/Infra/Services/App/Tests，不再含空 Interop。
- xUnit 当前为 33 个行为/合同测试；Full gate 仍保留三科 snapshot、cross-subject、PDF delivery smoke 和三科 answer eval。

这些数字证明的是维护面收缩，不证明答案准确率提升。真实准确性仍以 `eval/real-paper/` 的阶段化结果为准。

## 文档、spec、verifier 与任务真值

- PRD：`docs/strategy/product-prd.md` 定义单机课堂答案交付、非目标和验收边界。
- 终态基线：`docs/strategy/final-implementation-baseline.md` 定义唯一主链、保留/冻结模块和不变量。
- 路线图：`docs/strategy/implementation-roadmap.md` 独立列出 repo、live、reference-reviewed 和 accepted 状态。
- 实施计划：`docs/strategy/implementation-plan.md` 以 Epic 描述范围、验收、门禁和 stop 条件。
- spec：三科 compiled/mirrored spec 均由 `prompts/specs/` 人类真源生成；不得手改生成物。
- verifier：固定顺序仍是 `build -> test -> contract/invariant -> hotspot`；hotspot 内按 Fast/Core/Full 路由。
- 任务清单：`docs/strategy/execution-backlog.md` 是唯一 active task 真源。PRE/SPEC/ARCH/GATE/SDK/TEST/EVAL 均有目标、write-set、步骤、验收、命令、证据、回滚、依赖、边界和停止条件。

## 当前唯一未实现项

`VISION-101` 保持 `blocked`，不是 repo 缺陷或可以继续堆代码解决的普通 backlog：

1. `EVAL-101` 已 verified；
2. 真实部件级标注 authority 不存在；
3. provider endpoint 稳定性没有当前证明；
4. 四类对象预算没有批准。

任一条件缺失都禁止编码。不得用 synthetic schema、通用视觉平台、更多提示词或本地自验数据伪造解锁证据。

## Fresh verification

2026-08-03 在最终 staged-equivalent 工作树按固定顺序执行：

| 顺序 | 命令 | 结果 |
| --- | --- | --- |
| build | `dotnet build ClassroomToolkit.sln -c Debug` | exit 0；0 warning；0 error |
| test | `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build` | exit 0；33 passed；0 failed；0 skipped |
| contract/invariant | `npm --prefix tools/rule-compiler run validate:assets` | exit 0；12 schemas、3 subject packs、spec boundaries、assemblies、snapshots、renderer contracts 通过 |
| hotspot | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full` | exit 0；259.78 s；17 AI tests、3 output-path tests、三科 snapshots/evals、cross-subject 与 PDF delivery smoke 通过 |
| hygiene | `git diff --check` | exit 0；仅 Git 行尾转换 warning，无 whitespace error |

Full gate 明确报告 cloud egress disabled、provider keys missing；因此它是 repo-side 验证，不是 live provider、真实视觉定位或教师验收。

## 资产与动作边界

- 未修改 `.env`、用户原卷、`tmp/pdfs/2024-*` 或 `正式交付/**`。
- 未发起新的 provider 请求；未安装系统 SDK；未重启/终止 Codex；未启动可见 WPF。
- 本证据随用户授权的 Git closeout 提交投影；最终 commit 与 push parity 以 Git 历史和远端 ref 为准。

## 回滚

- 按 PRE/SPEC/ARCH/GATE/SDK/TEST/EVAL 的 evidence 分片独立回滚，禁止整树破坏性恢复。
- spec 回滚必须同时恢复 commons、assemblies、manifest/config/checklist 与生成物版本。
- dormant 模块只有满足 `product-core-simplification.md` 的 re-enable criteria 才能重新进入 active 产品面。
- 不以删除或覆盖用户试卷、真实交付、`.env` 或外部运行资产作为仓库回滚手段。
