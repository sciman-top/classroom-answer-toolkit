# Active Execution Backlog

本文件是唯一 active task 真源。旧 62-task backlog 仅从 Git 基线读取：`git show 6cf3904:docs/strategy/execution-backlog.md`。

## Status and execution protocol

- 只有 `status: ready` 的任务可由 AI 自动执行。
- `blocked` 必须满足全部 unlock 条件后才能改为 ready。
- `verified` 必须有当前 revision 可达的实现、fresh gate 输出和 evidence。
- `repo_supported`、`workflow_integrated`、`gateway_verified`、`reference_reviewed`、`teacher_accepted` 独立报告。
- 所有任务禁止修改 `.env`、用户原卷、未列入 write-set 的正式交付和其他未提交资产。

## TASK PRE-001 — 当前 live workflow 切片收口

- status: verified
- goal: 独立验证并收口当前 2024 Visual Audit 工作树改动。
- inputs: 当前 workflow/gateway/renderer/test/README diff 与 `docs/change-evidence/20260801-live-2024-answer-workflow.md`。
- preconditions: 保留所有用户未跟踪试卷和交付资产；不启动新的架构删除。
- allowed_write_set: `README.md`, `scripts/run-live-answer-workflow.ps1`, `tools/ai-gateway/answer-*.mjs`, `tools/latex-renderer/review-source-pdf.mjs`, 对应 focused tests 与单份 evidence。
- forbidden_write_set: frozen tools/schema/WPF、`.env`、用户试卷、其他正式交付。
- implementation_steps: 核对 diff -> focused tests -> 固定门禁 -> evidence 真值复核 -> 单独 closeout。
- acceptance_criteria: 当前 diff 可独立解释；blind failure 与 reference-reviewed correctness 分开；没有混入本 backlog 后续删除。
- verification_commands: `node --test tools/ai-gateway/answer-request.test.mjs tools/ai-gateway/answer-diff-report.test.mjs`; PowerShell parse；固定门禁按可用性执行。
- evidence_output: `docs/change-evidence/20260801-live-2024-answer-workflow.md`。
- rollback: 只回滚当前 live workflow diff。
- dependencies: none
- truth_boundary: reference-reviewed delivery correct; blind Q16-Q18 unresolved; teacher accepted false。
- stop_conditions: provider 不稳定或 build SDK 不可用时记录准确边界，不扩建 synthetic/provider/schema 框架。

## TASK SPEC-101 — 生产 spec 去旧证据对象

- status: verified
- goal: 从 active 三科组合规范移除 frozen 内部证据对象，并固定 Markdown-only 输出。
- inputs: commons 源规范、三科 assemblies、manifest/config/checklist。
- allowed_write_set: `prompts/specs/`, `prompts/*-answer/{manifest.json,config.json,spec.md,README.md,checklists/acceptance.md}`, spec verifier/tests。
- forbidden_write_set: 业务 workflow、provider 配置、用户资产、frozen 工具实现。
- implementation_steps: 改 commons 源 -> 提升组合版本 -> assembler 重建 -> spec-boundary negative/positive 验证。
- acceptance_criteria: active spec 无禁用对象名；完整 Markdown 输出、图号绑定、仪表锚点和 fail-closed 语义保留。
- verification_commands: `npm --prefix tools/spec-assembler run assemble:all -- --check`; `npm --prefix tools/rule-compiler run validate:spec-boundary`; `npm --prefix tools/rule-compiler run validate:assets`。
- evidence_output: 本切片 final verification；提交前可新增一份精简 change-evidence。
- rollback: 恢复 commons、assembly 版本、manifest/config/checklist 和 generated outputs。
- dependencies: none
- truth_boundary: spec contract only; not live accuracy proof。
- stop_conditions: 不通过增加提示词长度或新视觉 schema 补偿删除。

## TASK ARCH-101 — 删除 dormant 工具与旧 schema

- status: verified
- goal: 删除退出主链的工具、仅服务它们的 schema/fixture/package 入口。
- inputs: Final Implementation Baseline frozen list、引用扫描和当前 gates。
- allowed_write_set: frozen `tools/` 目录、对应 `prompts/shared/schemas/`、对应 eval/fixture、package scripts、引用测试和策略索引。
- forbidden_write_set: retained modules、live workflow、用户资产、历史 evidence。
- implementation_steps: 建立消费者清单 -> 分组删除 -> 每组 focused test -> Full verifier。
- acceptance_criteria: retained workflow/package/gate 无 frozen 引用；active schema 只覆盖当前产品。
- verification_commands: `rg` 消费者扫描；build/test；`validate:assets`; Full verifier。
- evidence_output: 单份 dead-surface-removal evidence。
- rollback: 按任务提交恢复删除文件，不迁移或覆盖数据。
- dependencies: SPEC-101
- truth_boundary: repository cleanup only。
- stop_conditions: 发现 retained workflow 真实消费者时停止对应目录删除并记录依赖。

## TASK ARCH-102 — 清理 WPF/.NET 死表面

- status: verified
- goal: 删除空 Interop 和无生产消费者的 ReviewQueue/VisualDecision/DeliveryAggregate DTO 与诊断字段。
- inputs: solution/project references、生产消费者扫描、WPF/headless tests。
- allowed_write_set: `ClassroomToolkit.sln`, `src/`, `tests/`, packaging/headless scripts 与相关策略。
- forbidden_write_set: Node 业务逻辑、用户资产、live provider。
- implementation_steps: 删除空项目 -> 删除死 DTO -> 清理 diagnostics 字段 -> behavior tests。
- acceptance_criteria: WPF 仍完成本地答案交付、状态显示和产物打开；不新增替代抽象。
- verification_commands: build/test；headless smoke；涉及可见 UI 时执行 UI Automation 或人工探针。
- evidence_output: 单份 WPF dead-surface evidence。
- rollback: 恢复 solution/project/DTO/diagnostics 变更。
- dependencies: PRE-001
- truth_boundary: repo/WPF behavior only; no classroom acceptance claim。
- stop_conditions: 发现外部兼容消费者或需要启动当前长运行应用时停止并请求授权。

## TASK GATE-101 — Fast/Core/Full 门禁分层

- status: verified
- goal: 去除重复验证并支持按 Subject Pack 路由。
- inputs: 当前 `check-toolchain.ps1`、实测耗时和 AGENTS 固定顺序。
- allowed_write_set: `scripts/check-toolchain.ps1`, gate-focused tests, `README.md`, `AGENTS.md`, strategy gate docs。
- forbidden_write_set: renderer/AI 业务语义、live provider、用户资产。
- implementation_steps: 参数和模式 -> step routing -> Subject Pack 过滤 -> 计时摘要 -> docs/tests。
- acceptance_criteria: Fast/Core/Full 可独立运行；Core 不跑无关学科；Full 保留三科 smoke/eval；输出 executed/skipped/elapsed。
- verification_commands: 三模式 dry/focused execution；最终 Full verifier。
- evidence_output: gate-tiering evidence 或 final verification 摘要。
- rollback: 恢复单一 check-toolchain 脚本和旧文档命令。
- dependencies: none
- truth_boundary: verifier ergonomics, not product acceptance。
- stop_conditions: 不通过降低质量断言或跳过共享变更的 Full gate 达成耗时目标。

## TASK SDK-101 — .NET patch 兼容

- status: verified
- goal: 保持 .NET 10 feature band，同时允许兼容 patch SDK。
- allowed_write_set: `global.json`, `scripts/bootstrap.ps1`, SDK contract tests/docs。
- forbidden_write_set: 系统 SDK、Codex 进程、用户环境变量。
- implementation_steps: `10.0.300 + latestPatch` -> bootstrap 按 feature band 探测 -> build/test。
- acceptance_criteria: 仅有 10.0.302 时可 build/test；.NET 8 不被当作项目 SDK。
- verification_commands: `dotnet --version`; build; test --no-build。
- evidence_output: SDK compatibility evidence。
- rollback: 恢复精确 10.0.301 合同。
- dependencies: GATE-101
- truth_boundary: workstation build compatibility only。
- stop_conditions: CI/release 明确要求 10.0.301 字节级复现时先记录冲突再决定。

## TASK TEST-101 — 行为测试再平衡

- status: verified
- goal: 用 CLI/JSON/manifest/ViewModel 行为替换高价值路径上的源码字符串断言。
- allowed_write_set: `tests/`, retained tools 的 focused tests、必要测试 seam。
- forbidden_write_set: 为测试引入通用 UI E2E 平台、生产功能扩张。
- implementation_steps: 盘点 Contains 合同 -> 按风险替换 -> 保留少量禁止项扫描 -> mutation/red-green 证明。
- acceptance_criteria: 实现重命名不导致无行为变化失败；删除真实行为会使测试失败。
- verification_commands: focused tests；build/test；Core verifier。
- evidence_output: test-rebalancing evidence。
- rollback: 恢复原合同测试。
- dependencies: ARCH-101, ARCH-102, GATE-101
- truth_boundary: automated behavior proof only。
- stop_conditions: 原生 WPF 可见行为需要启动/操作应用时按技能边界先请求授权。

## TASK EVAL-101 — 2024/2025 真实错题基准

- status: verified
- goal: 固定真实 authority、输入 hash 和 blind/audit/reference 三阶段结果。
- initial_cases: 2024 Q5/Q16/Q17/Q18；2025 Q8/Q11/Q12/Q17/Q18。
- allowed_write_set: real-eval metadata、非敏感 hash/index、eval runner/tests、evidence。
- forbidden_write_set: 用户原卷内容复制入仓、题库索引、synthetic optimization。
- acceptance_criteria: 每阶段单独报告；reference 正确不覆盖 blind/audit failure。
- verification_commands: offline authority validation；显式授权的 live rerun；Core/Full verifier。
- evidence_output: per-run evidence with hashes and acceptance boundary。
- rollback: 删除本任务 metadata/runner，不删除用户文件或历史交付。
- dependencies: PRE-001, GATE-101
- truth_boundary: real regression evidence; teacher accepted remains separate。
- stop_conditions: authority 缺失、provider 不稳定或需要暴露用户资产时停止。

## TASK VISION-101 — 有限部件级视觉定位

- status: blocked
- goal: 针对真实错题建立有限、可验证的部件定位和结构化读数。
- unlock_conditions: EVAL-101 verified；真实部件标注 authority 可用；provider endpoint 稳定；写明四类对象和预算。
- allowed_write_set: 解锁后另行评审。
- forbidden_write_set: 通用 OCR/layout 平台、synthetic 证据链、审批队列、信任聚合系统。
- truth_boundary: 即使局部读数正确也不自动提升整卷 trusted 或 teacher accepted。
- stop_conditions: 任一 unlock 条件缺失即保持 blocked。
- unlock_audit_2026-08-02: EVAL-101 baseline 已建立；真实部件级标注 authority 仍不存在，provider 稳定性也未形成当前证明，四类对象预算未批准，因此继续 blocked。
