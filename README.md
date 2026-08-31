# Classroom Answer Toolkit

本项目只解决一件事：把试卷生成的答案交付为符合课堂排版要求的 Markdown 和 PDF。

主链：

```text
试卷 PDF
  -> 页面图
  -> 当前 subject-pack 提示词 + AI 作答
  -> 4x 题目级左右重叠视窗 + 无参考答案视觉审计
  -> 可选：参考答案 PDF 复核与校正
  -> Markdown 规则校验
  -> PDF 排版
  -> review 页图、交付专属 snapshot 与 delivery manifest 1.1
  -> workflow run receipt
```

本项目不是题库系统，不负责试卷入库、标签治理、知识图谱或样例飞轮。原卷与参考答案可以保留在用户自己的资料目录中；运行脚本接受任意明确路径，不要求把资料迁入项目资产结构。

## 当前状态

- 初中物理运行提示词：`prompts/specs/compiled/` 的完整版汇编产物，经 `prompts/junior-physics-answer/manifest.json` 的 `sourceOfTruth.humanSpec` 解析；当前版本以该 manifest 为准。
- 已真实跑通 2025 广州中考原卷到 Markdown/PDF 的完整链路。
- 默认主链不再把单次整卷盲答直接送去排版：先以 4x 重渲染原卷，按 PDF.js 题号切成每题两个带重叠的高清视窗（续页继承题号）执行独立视觉审计，再进入可选参考答案复核。
- 局部高清审计能降低滑轮、刻度尺和钩码计数错误，但不能保证消除所有仪表盘歧义；未经参考答案或人工复核仍不得声明答案可信。
- 2024/2025 实跑交付位于 `正式交付/`；仓内 `广州物理中考试卷/` 是明确版本化的广州真题 golden corpus。其他用户原卷仍可从任意路径输入，无需复制进仓库。
- 新实跑输出默认经 `scripts/archive-delivery-run.ps1` 归档到仓外并不入 Git（2017-2023 历史归档见 `docs/change-evidence/20260823-archive-2017-2023-deliveries.md`）；仅当同时具备可重复回归价值、权威输入来源、完整 hash/回执与明确真值边界时，才通过显式基线切片准入。
- 可复现的页面图、裁剪图和诊断输出只写入 ignored `tmp/`；不得把它们重新提交。长期回归仅保留 `eval/real-paper/` 的最小 hash-bound 基准。

## 最短运行

从原卷直接生成并排版：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-live-answer-workflow.ps1 `
  -SourcePdf "广州物理中考试卷/2025广州中考.pdf" `
  -ReferencePdf "广州物理中考试卷/2025广州中考（答案）.pdf" `
  -OutputDirectory "正式交付/2025广州中考" `
  -KeepReview
```

若 Node 直连 AI 网关出现 `UND_ERR_CONNECT_TIMEOUT`，但本机已配置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`，可在同一命令增加 `-UseGatewayProxy`。该开关只在本次工作流进程内启用 Node 环境代理，并仅从本次子进程的 `NO_PROXY` 副本中移除 `.env` 已配置的 AI 网关主机；不会修改持久环境变量。

工作流默认执行视觉审计。只有诊断旧链或明确控制 provider 成本时才使用 `-SkipVisualAudit`；这会恢复单次盲答路径，不能作为可信交付。

每个 AI 阶段都会原子写入独立的 `*.summary.json`；工作流最终写入 `<原卷名>.workflow-run.json`，记录 run id、输入 SHA-256、阶段 `completed/skipped/failed`、当前阶段产物和最终交付哈希。两类回执在写出时都经 `prompts/shared/schemas/` 的 schema 校验，结构漂移即失败。失败回执会指向保留的临时诊断目录；这些回执证明本次执行和文件绑定，不证明答案语义正确。

只对已有答案 Markdown 做校验和 PDF 交付：

```powershell
npm --prefix tools/latex-renderer run deliver -- `
  "正式交付/2025广州中考/2025广州中考参考答案.md" `
  "正式交付/2025广州中考/2025广州中考参考答案.pdf" `
  --subject-pack junior-physics-answer `
  --profile classroom `
  --keep-review
```

live AI 请求必须显式允许云出网，并读取本机 `.env`。仓库不存储密钥。

## 核心目录

- `prompts/specs/`：人类规范真源；compiled 文件由 assembler 生成。
- `prompts/junior-physics-answer/`：规则、排版 profile 和版本 manifest；运行提示词由 `prompts/specs/compiled/` 的汇编产物承担。
- `tools/ai-gateway/`：显式云出网的答案生成请求。
- `tools/rule-compiler/`：subject-pack、规则和 snapshot 编译与校验。
- `tools/latex-renderer/`：Markdown 校验、PDF 渲染、review 页图和交付 manifest。
- `scripts/run-live-answer-workflow.ps1`：真实原卷主链入口。
- `src/`：App、Domain、Infra 三个生产项目；WPF 只承载主链操作、状态展示与本机适配。
- `eval/junior-physics-answer/`：共享 renderer/layout 合同与主产品包回归；其他学科只保留独有 case 和 subject-pack sentinel。

## 验证

按变更面运行最低充分检查：

```powershell
# WPF / Domain / Infra
dotnet build ClassroomToolkit.sln -c Debug
dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build --filter "Gate!=ToolchainIntegration"

# subject-pack spec / rules
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer
```

AI gateway、renderer 和 eval 改动运行各自 package 的 focused Node 测试；workflow、publish、packaging 或 Node CLI 合同再运行 `Gate=ToolchainIntegration` 的 20 项 .NET 集成测试。Core 只做联合资产合同与目标 subject-pack 的 profile snapshot，通常数秒完成；不再捆绑无关 gateway/renderer 测试或 PDF eval。共享 spec/schema、跨学科或 release 变化才使用 `-Mode Full`。Core/Full 已内置一次 `validate:assets`，不要在外层重复执行。

Full 中共享 renderer/layout/delivery 回归只由 `junior-physics-answer` eval 承担一次；廉价 manifest 合同独立验证负向边界。Senior/Math 仍使用各自 snapshot 和独有 sentinel，不能把共享回归去重解释为跳过跨学科合同。

`scripts/bootstrap.ps1` 会安装基础依赖，只用于环境初始化，不是日常门禁；可选 OCR 由 renderer 的 `review-source-pdf --ocr` 显式启用。

## 弃用入口（2026-09-30 移除）

以下手动入口无主链调用方，已进入弃用窗口；期限后再无依赖即删除，删除方案与证据另行走独立切片：

- ai-gateway：`request:text`（text-request.mjs）、`probe:text`（validate-config `--live`）、`TEXT_PROVIDER_*` 旧环境变量前缀、answer-request 的 `--image` flag、不带 `--audit-findings-only` 的整卷 `visual_audit` 模式。
- rule-compiler：`resolve:profile`。
- latex-renderer：`visual:smoke`（移除时连同各 subject-pack manifest 的 `visualSmoke` 字段一起处理）。

## 桌面发布边界

WPF 当前是仓库伴随应用，运行 check/deliver 仍依赖外部可写仓库以及其中的 Node/npm、PowerShell、prompt、snapshot 和 eval 状态。`scripts/publish-app.ps1` 会清空准确的 publish 目录，以 Release 生成应用，并在仓库外复制发布树执行隔离启动 smoke；该 smoke 只验收“应用可启动且缺少仓库时正确 fail closed”，回执绑定 source commit、EXE SHA-256 和 publish-tree SHA-256。

`scripts/pack-msix.ps1` 会校验回执是否属于当前 commit 和当前 publish tree，但在可写、版本化 runtime bundle 及安装/升级合同落地前始终阻断 MSIX 创建。不得把当前 publish/smoke 结果描述为自包含安装包验收。

## 获取与迁移

项目提供五种互不覆盖的分发方式。它们都不把真实 API key 放入 GitHub Release 或公开源码包。

| 方式 | 面向对象 | 内容 | 更新边界 |
| --- | --- | --- | --- |
| ordinary-user 标准安装版 | 教师及其他普通 Windows 用户 | 签名 setup、内置 runtime、开始菜单、修复/升级/卸载 | 通过 setup 覆盖安装；只有签名和普通用户验收齐备后才标记 stable |
| ordinary-user 绿色便携版 | 不希望安装的教师及其他普通 Windows 用户 | 自包含 runtime，解压即用，不写注册表 | 下载并解压新 ZIP；运行中不自替换 |
| 联网 developer/operator 预览版 | 熟悉仓库与本机工具链的维护者 | Release 中独立校验的 `app` 包和匹配公开工作区 | 初始安装下载两个公开资产；仅在 `workspaceContract` 一致时自动替换 `app`，保留 `.env`、源码和用户文件 |
| 公开源码开发包 | 开发者与开源协作者 | `source` 包、测试、脚本、prompt、锁文件和 `.env.example` | 使用 Git 或下载新的 source 包；自动初始化不覆盖已有 `.env` |
| 私用开发迁移包 | 同一维护者换电脑 | 当前源码快照，可显式包含 `.env`、`.git` 和已发布应用 | 导入时先校验 manifest，已有目标会备份；不静默覆盖开发修改 |

从 GitHub Release 下载 `install-release.ps1` 后，developer/operator 预览版可执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\install-release.ps1 -RunSetup -Launch
```

该脚本只接受 GitHub HTTPS 清单和资产，校验 app/source 两个资产的 SHA-256 与字节数，拒绝越界 ZIP 条目。预览版会将匹配的公开源码工作区安装在本机，但源码仍是独立 Release 资产，不嵌入 app ZIP。setup 会执行 build、普通测试、Core 和主 subject-pack 健康 eval；首次安装会从 `.env.example` 创建本机 `.env`，但云出网仍为关闭状态，必须由使用者自行填写 provider 配置后才能请求 live AI。

每个 Release 都声明 `workspaceContract`。合同相同的版本可自动更新应用；合同提升时客户端会拒绝只替换 app，避免应用、脚本和 prompt 静默错配。此时应保留现有工作区与 `.env`，再使用新 Release 的预览安装器部署到新的空目录。ordinary-user 标准安装版和绿色便携版已经实现并由同一版本化 runtime bundle 构建；本机可用 `-AllowUnsignedCandidate` 验证安装、修复、卸载和便携启动，但没有签名或代表性普通用户验收时不得标记为 stable。完整离线 AI 能力仍未提供：provider 请求仍需使用者自行配置并联网。

公开源码包或 Git clone 在新机器执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/setup-development.ps1
```

它会检查/安装必要工具、恢复锁定依赖、编译 snapshot，并运行 build、普通测试和 Core gate。私用迁移包由维护者在旧机器生成：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/export-transfer.ps1 `
  -Mode PrivateDev -Version 1.0.3 -IncludeEnv -Output "D:\Transfer\ClassroomToolkit-private.zip"
```

在新机器导入时：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/import-transfer.ps1 `
  -Package "D:\Transfer\ClassroomToolkit-private.zip" `
  -Destination "D:\CODE\classroom-answer-toolkit" `
  -RunSetup
```

默认公开包禁止 `.env` 与 `.git`；私用包只有显式 `-IncludeEnv` 才携带密钥。不要上传私用包，也不要把它作为 GitHub Release 资产。更完整的操作、回滚和发布流程见 [release-and-transfer.md](docs/release-and-transfer.md)。

可由 AI 或自动化操作员执行不产生外部发布副作用的发布模拟验收：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/simulate-release-acceptance.ps1 -Version 1.0.3
```

该回放使用临时 loopback 源驱动真实安装、更新、故障回滚和 PrivateDev 迁移脚本，结果是 `simulated-acceptance`，不能替代代码签名、GitHub 发布、普通用户实机、真实 provider 或教师/课堂验收。

## 交付物目录

本机可重建产物统一写入 `artifacts/`；除提交的目录说明外，其内容均被 Git 忽略。每个版本的普通用户安装版、绿色便携版、developer/operator 安装预览、公开源码和私用迁移包分别放在 `artifacts/deliveries/<version>/installer/stable/`、`portable/`、`installer/preview/`、`source/` 和 `private-transfer/`，版本清单、SBOM 与 provenance 放在 `_release-metadata/`；历史证据放在 `artifacts/history/<kind>/<date-or-id>/`，构建/审计中间物放在 `artifacts/work/<kind>/`，三者不在同一层混放。目录约定和清理命令见 [`artifacts/README.md`](artifacts/README.md)。正式公开下载以 GitHub Release 资产为准，仓库不提交大体积 ZIP、EXE 或本机诊断数据。

当前交付合同包含 ordinary-user 标准安装版、ordinary-user 绿色便携版、`developer/operator preview`、公开源码包和 PrivateDev 迁移包五类；标准安装版与绿色版共享版本化 runtime bundle，前者负责安装/更新/卸载，后者解压即用且不写注册表。只有完成代码签名和代表性非开发者验收后，才可标记为 stable 对外发布；不会用 preview ZIP 代替发布。

当前发布状态：GitHub 上的 `v1.0.1` 是已存在的 tag/release 资产；后续 `main` 的发布、安装、迁移和签名边界加固已在仓库中完成，但尚未由新的 tag/release 对外发布。不要把本机 `artifacts/deliveries/<version>/` 候选包当作线上下载地址；发布前必须重新打 tag、运行 workflow，并以新的 `update-manifest.json` 和 provenance/SBOM 为准。

## 可信边界

`delivery-manifest.json` 1.1 会把输入 Markdown、最终 PDF、同目录交付 snapshot 和 `<PDF基名>.review/` 包内 review 文件绑定到字节数与 SHA-256；validator 会拒绝缺失、篡改或 review 文件集合漂移。`.pdf-review/` 只保留可选调试副本，不是归档依赖。该 manifest 证明的是指定文件之间的交付关系，不证明答案语义必然正确。答案可信需要满足以下至少一项：

- 与权威参考答案逐题比对并完成校正；
- 由教师逐题复核；
- 后续自动比对能力给出可审计差异，并由规则或人工处理未决项。

继续扩写 100 KB 级主提示词不是当前主要优化方向。优先级是参考答案复核、局部高清题图、遗漏检测和真实试卷回归。
