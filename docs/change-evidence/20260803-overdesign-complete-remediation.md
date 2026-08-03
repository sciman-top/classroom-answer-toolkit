# 过度设计彻底收口证据

## Goal

把 2026-08-03 深度审计发现的 active 残余一次收口：删除无消费者资产，防止临时输出回流，
去除跨学科重复 browser eval，收敛小型 WPF 程序集边界，并把历史治理决策退出 active 上下文。

## Baseline

- tracked 文件：740。
- `tmp/`：198 文件 / 37.47 MiB；active 消费者为 0，来源提交为 `e11839a`。
- `.answer-graphics/`：13 个已退役产物；active 消费者为 0。
- 根目录旧 v8.1-v8.13 提示词：12 份 / 920.9 KiB；生产真源已为 v8.15 compiled spec。
- WPF：5 个生产程序集、33 个 C# 文件 / 1185 行；Application 仅承载一个 13 行接口。
- Full 审计实测：202.08s；Junior/Senior/Math eval 分别为 64.12s / 55.33s / 43.67s。
- Senior 与 Junior 共享 13 个同名 case；当前 eval 有 32 组、64 个逐字节重复文件。

## Changes

### Active-tree hygiene

- 删除全部 tracked `tmp/` 和 `.answer-graphics/`；在 `.gitignore` 增加精确防回流规则。
- 删除 12 份根目录旧提示词；历史版本继续由 Git 提供。
- 保留 `广州物理中考试卷/` golden corpus、`正式交付/`、`eval/real-paper/`、`.env` 和所有用户交付。
- 清除退役 Application/Services 项目的 ignored `bin/obj` 和空物理目录。

### Eval ownership

- Junior Physics 明确为 `shared-renderer-and-primary-subject`，继续承担共享 renderer/layout 回归。
- Senior Physics 明确为 `subject-pack-sentinel`，保留 smoke、figure binding、两项 instrument reading 和 necessary derivation 五个独立 case。
- Senior 仍使用自己的 manifest、两种 profile 和 snapshot；不是复用 Junior 的运行结果。
- 新增 xUnit 所有权合同，阻断共享回归再次跨学科机械复制。

### WPF assembly boundary

- `IToolchainOrchestrator` 移入 Domain。
- `LocalToolchainOrchestrator` 与 DI extension 移入 App。
- 删除 Application/Services 项目与解决方案引用；生产程序集收敛为 App、Domain、Infra。
- 保留接口、DI、进程和工作区边界，不把 Node/PowerShell 业务逻辑复制进 WPF。

### Governance context

- active decision log 只保留 D-035/D-036；D-001 至 D-034 移到 archive 并标明不可恢复 frozen 模块。
- README、AGENTS、架构、基线、路线图和实施计划同步新的资产、程序集与 eval 所有权。

## Fresh verification

固定顺序：

```text
dotnet build ClassroomToolkit.sln -c Debug
exit=0; warnings=0; errors=0; wrapper elapsed=2.38s

dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build
exit=0; passed=34; failed=0; skipped=0; wrapper elapsed=8.06s

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full
exit=0; gate elapsed=144.04s; wrapper elapsed=144.61s
assets=1; subject snapshots=6; cross-subject=1; delivery-smoke=1; subject evals=3
```

Full runtime：

```text
junior: profiles=28; snapshots=2; browser=1; visual=8; delivery=6; elapsed=47.39s
senior: profiles=10; snapshots=2; browser=1; visual=2; delivery=2; elapsed=18.02s
math:   profiles=16; snapshots=2; browser=1; visual=14; delivery=2; elapsed=49.90s
```

与本次审计前同工作站实测相比：

- Full：202.08s -> 144.04s，减少 58.04s / 28.7%。
- Senior：55.33s -> 18.02s，减少 37.31s / 67.4%。
- 固定总链：221.43s -> 155.04s，减少 66.39s / 30.0%。

最终暂存集复确认（2026-08-03）：

```text
build: exit=0; warnings=0; errors=0; elapsed=1.83s
test: exit=0; passed=34; failed=0; skipped=0; elapsed=5s
full: exit=0; gate elapsed=138.38s; fixed-chain elapsed=149.04s
junior/senior/math eval: 50.03s / 17.39s / 45.24s
```

## Truth boundary

- 本证据证明 repo-side 物理收口、程序集兼容、合同和 Full verifier 通过。
- 云出网保持 disabled；未运行 provider、真实生成、WPF 人工课堂流或教师验收。
- `teacher_accepted` 仍未记录；`VISION-101` 仍因 authority、endpoint 和预算条件保持 blocked。

## Rollback

- 资产切片：恢复删除项并移除 ignore 规则，但不得把恢复历史当作重新启用 frozen 模块。
- eval 切片：恢复 Senior dataset/case/baseline，并删除所有权合同。
- WPF 切片：恢复 Application/Services 项目和原命名空间/引用。
- 治理切片：恢复旧 decision log 与索引。只回滚本任务，不修改原卷、正式交付、`.env` 或 provider 配置。
