# Classroom Answer Toolkit

面向中小学试卷参考答案的生成、校验、渲染与交付工具链。
Windows-first toolkit for generating, validating, and rendering K12 exam answer sheets to Markdown, LaTeX, and PDF.

## 项目定位 / Positioning

Classroom Answer Toolkit 是一个以 Windows 本地环境为主的教育内容交付工具链，目标是把试卷参考答案内容生成、校验并渲染为适合课堂投屏、打印分发和归档复用的 Markdown、LaTeX 与 PDF 文件。

This project provides a local Windows workflow for generating, validating, and rendering exam answer deliverables for classroom display, printing, and reuse.

## 先读哪里 / Where To Read First

- 规划与实施真值入口：[docs/strategy/README.md](./docs/strategy/README.md)
- 产品 PRD：[docs/strategy/product-prd.md](./docs/strategy/product-prd.md)
- 权威实施规格：[docs/strategy/final-implementation-baseline.md](./docs/strategy/final-implementation-baseline.md)

## 当前能力 / Capabilities

- 学科规则与运行配置使用 `subject-pack` 组织。
- 答案 Markdown 在渲染前执行格式与 LaTeX 基线校验。
- PDF 渲染保留真实数学公式输出，而不是降级为普通文本。
- 支持源 PDF 与答案 PDF 的页面审阅图生成。
- 已落地视觉证据编译器契约层 schema 和最小离线 `DecisionRecord` 编译器，用于表达 `questionRef -> figureRef -> cropRef -> evidenceRef`、三轨候选、风险分类和 review/trust 决策。
- 已把 QQ 重链路经验移植为阶段化视觉证据产物：`VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` 通过 `TrackResult.stageArtifactRefs` 接入，并新增 `unsafe_shortcut_fail` fail-closed 样例。
- 已落地可选 AI 网关配置校验入口、文本请求主备切换和显式视觉 TrackResult 探针；云外发默认关闭，真实密钥只保留在本地 `.env`。
- 已落地自动解题工作站终局计划与 Typst 主渲染迁移计划；当前运行时仍保持 Playwright / Chromium。
- 支持实验性的受控插图插入链路，可把用户提供或人工复核后的答案图块插入 PDF。
- WPF 桌面应用提供本地工具链入口和工作区诊断。

English summary:

- Subject policies and runtime profiles are organized as `subject-pack` assets.
- Answer Markdown is validated before rendering.
- PDF output keeps real LaTeX math rendering.
- Source PDFs and rendered answers can be reviewed through generated page images.
- Visual-evidence compiler schemas and a minimal offline `DecisionRecord` compiler define evidence chains, track results, risk labels, and review/trust decisions.
- QQ heavy-chain lessons are now mapped into staged visual artifacts: `VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` are referenced through `TrackResult.stageArtifactRefs`, with an `unsafe_shortcut_fail` fail-closed fixture.
- Optional AI gateway config validation, text failover, and explicit vision TrackResult probes are available; cloud egress is disabled by default and real keys stay in local `.env`.
- The final auto-solving workstation and Typst primary-renderer migration plans are documented; the current runtime remains Playwright / Chromium.
- Experimental controlled-graphic helpers can place reviewed answer graphics into PDFs.
- The WPF app provides a local toolchain entry point and workspace diagnostics.

## 当前范围 / Current Scope

- `junior-physics-answer`: 当前主线，面向初中物理试卷参考答案。
- `senior-physics-answer`: 已落盘的高中物理模板包，用于后续扩展与回归接入。
- `math-answer`: 实验性第二学科支架，用于验证平台契约不依赖单一物理学科。

内部解决方案、项目名和命名空间暂时仍使用 `ClassroomToolkit`。对外展示名统一为 `Classroom Answer Toolkit`。

The internal solution, project names, and namespaces still use `ClassroomToolkit`. The repository-facing name is `Classroom Answer Toolkit`.

## 目录结构 / Repository Layout

- `src/`: WPF 应用与 .NET 编排层。
- `scripts/`: 初始化、自检、发布和打包脚本。
- `prompts/`: 学科资产、规则、配置、清单和 schema。
- `prompts/specs/`: 人类可读规范真值区，含分层源规范、装配清单与自动生成产物。
- `样例交付/`: 回归验证、演示和冒烟测试使用的样例题卷与交付物。
- `正式交付/`: 面向真实生产交付的题卷工作区。
- `docs/strategy/`: 平台化路线、执行路线图与视觉降错专项方案。
- `docs/adr/`: 关键决策记录。
- `tools/latex-renderer/`: Markdown、LaTeX、PDF 渲染、审阅与交付工具链。
- `tools/ai-gateway/`: 可选 AI 网关配置校验与显式 live 探针入口。
- `tools/visual-evidence/`: 视觉证据 `DecisionRecord` 离线编译与 fail-closed 合同测试。
- `tools/answer-graphics/`: 实验性受控插图工具链，不是默认主交付链。
- `tools/ocr/`: 面向低质量扫描件和批量处理的本地 OCR 路径。
- `eval/`: 固定评测数据集、视觉基线和回归结果。
- `tests/`: xUnit 与 FluentAssertions 测试。

## 环境要求 / Requirements

- Windows
- .NET SDK `10.0.301`
- Node.js and npm
- Python `3.12+`
- Edge, Chrome, or Chromium

## 快速开始 / Quick Start

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1
dotnet build ClassroomToolkit.sln -c Debug
dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug
dotnet run --project src/ClassroomToolkit.App/ClassroomToolkit.App.csproj
```

## 常用命令 / Common Workflows

答案 Markdown 准备好后，执行交付渲染：

```powershell
npm --prefix tools/latex-renderer run deliver -- "<answer.md>"
npm --prefix tools/latex-renderer run deliver -- "<answer.md>" --profile compact
npm --prefix tools/latex-renderer run deliver -- "<answer.md>" --subject-pack senior-physics-answer
```

兼容说明：第一阶段仍接受旧包名 `physics-answer`，运行时会自动映射到 `junior-physics-answer`。

执行本地主链冒烟检查：

```powershell
npm --prefix tools/latex-renderer run smoke
```

校验可选 AI 网关配置，不会发起网络请求：

```powershell
npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets
npm --prefix tools/ai-gateway run validate:config
npm --prefix tools/ai-gateway run test:vision
npm --prefix tools/visual-evidence run test:decision
```

显式开启云外发后，可用合成短文本验证主备请求级切换：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt "Return exactly OK."
npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt "Return exactly OK." --force-primary-failure
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

显式开启云外发后，可用合成图片验证主备视觉请求级切换；该探针只验收 provider 图片理解入口和 `TrackResult` 结构化输出，不代表主答题流程已集成：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --provider primary
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --provider fallback
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --force-primary-failure
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

实验性受控插图链路如需单独验证，再运行：

```powershell
npm --prefix tools/answer-graphics run smoke
```

## 迁移到另一台电脑 / Move To Another PC

推荐通过 GitHub 拉取仓库，再在新电脑重建本地依赖：

```powershell
git clone https://github.com/sciman-top/classroom-answer-toolkit.git
cd classroom-answer-toolkit
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1
dotnet build ClassroomToolkit.sln -c Debug
```

`node_modules/`、`tools/ocr/.venv/`、`artifacts/`、`.snapshot-cache/` 等目录属于本地依赖或生成物，不需要提交到仓库。

## 状态 / Status

当前最完整的链路是初中物理参考答案生成与渲染。多学段/多学科支持已经在资产层、规范层和契约层展开，但产品层仍在演进中。
当前最成熟的交付主链仍是 `answer.md -> PDF/review`。项目正在按“飞轮先行、生成主链后接、视觉双轨后落地”的路线推进。
视觉降错本轮已进入契约层并具备最小离线决策编译：`NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord` 已纳入 schema 与资产校验，`VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` 已作为阶段产物落盘，双轨一致但证据缺失和直接跳答案缺 grounding 的样例都可由运行时代码推导为 `trusted=false`；真正的双轨/三轨运行时、局部高清 crop 和 review 队列产品化仍是后续工程。
自动解题工作站和 Typst 主渲染已作为终局计划落盘；Typst 未通过 parity gate 前，默认交付链仍是 Playwright / Chromium。
自动基于题图生成作图题答案图不再作为本项目的主需求；当前只保留“受控插图插入 PDF”的实验性底座。

The junior-high physics answer workflow is currently the most complete path. Multi-subject support exists at the asset and contract level, while product-level coverage is still evolving.
