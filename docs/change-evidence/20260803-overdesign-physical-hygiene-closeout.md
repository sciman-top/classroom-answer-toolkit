# 过度设计治理物理卫生收口证据

## Goal

完成 2026-08-02 深度审查后的两个非执行性尾项：把仍位于策略真源目录的 historical/frozen
计划迁入明确归档区，并清理已删除 visual 工具遗留的本机 Python 缓存和空目录。

## Risk and scope

- 风险级别：低；tracked 变更仅为历史 Markdown 迁移、索引和链接修复。
- 生产代码、schema、subject-pack、compiled snapshot、renderer 与 WPF 行为均未修改。
- 未跟踪的 `tmp/pdfs/2024-*` 和 `正式交付/**` 用户资产不在 write set 内。
- 本机缓存清理只覆盖预演确认的 9 个旧 `tools/visual-*` 目录；目录内容全部为 ignored
  `__pycache__/*.pyc`，对应 tracked 文件数为 0。

## Changes

- 将 29 份非 current `*-plan.md` 从 `docs/strategy/` 迁入
  `docs/archive/strategy-plans/`。
- 在归档目录增加执行边界：历史 `todo`、`next` 和完成定义不得生成任务或恢复已删除模块。
- 更新策略索引、归档索引、根跳转壳和跨目录 Markdown 链接。
- 删除 9 个旧 visual 工具目录中的 20 个 `.pyc` 及清空后的目录。

## Verification

按项目固定顺序执行：

1. `dotnet build ClassroomToolkit.sln -c Debug`
   - exit code：0
   - 结果：0 warning，0 error。
2. `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build`
   - exit code：0
   - 结果：33 passed，0 failed，0 skipped。
3. `npm --prefix tools/rule-compiler run validate:assets`
   - exit code：0
   - 结果：12 core schemas、3 subject packs、spec boundaries、compiled assemblies、snapshots
     与 renderer contracts 通过。
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full`
   - exit code：0
   - elapsed：227.30s
   - 结果：3 assemblies 的 spec boundary、AI gateway tests、renderer tests、cross-subject、
     delivery smoke 及 junior physics、senior physics、math eval 全部通过。

结构与链接验证：

- `docs/strategy/` 中 current `*-plan.md`：2 份。
- `docs/archive/strategy-plans/` 中 historical/frozen `*-plan.md`：29 份。
- 9 个旧 visual 工具目录：`exists=False` 且 `tracked=0`。
- 检查归档、受影响索引和本证据共 34 份 Markdown：`broken_links=0`。
- 旧 `docs/strategy/<historical-plan>.md` 引用：0。
- `git diff --check`：通过。

## N/A and external boundary

- `gate_na`：不适用；尽管 tracked 改动为文档迁移，本次仍执行完整 build/test/contract/Full 门禁。
- live provider 探针：`platform_na`；`reason=cloud egress disabled and API keys absent`，
  `alternative_verification=.env.example config validation plus local Full gate`，
  `evidence_link=this file`，`expires_at=next live acceptance run`，
  `recovery_condition=explicit egress authorization and valid provider credentials`。
- `teacher_accepted` 与 `VISION-101` unlock 条件不属于本次物理卫生清理，不改变其 open/blocked 状态。

## Rollback

仅回滚本次切片：把 `docs/archive/strategy-plans/*.md` 移回原 `docs/strategy/` 路径，恢复索引和
链接改动。ignored `.pyc` 不作为仓库回滚对象；需要时由仍然存在的 Python 源码重新生成，但本次
清理的旧模块已无 tracked 源码，不应为恢复缓存而重新引入模块。
