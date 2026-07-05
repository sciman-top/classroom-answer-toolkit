# Classroom Answer Toolkit

面向中小学试卷参考答案的生成、校验、渲染与交付工具链。
Windows-first toolkit for generating, validating, and rendering K12 exam answer sheets to Markdown, LaTeX, and PDF.

## 项目定位 / Positioning

Classroom Answer Toolkit 是一个以 Windows 本地环境为主的教育内容交付工具链，目标是把试卷参考答案内容生成、校验并渲染为适合课堂投屏、打印分发和归档复用的 Markdown、LaTeX 与 PDF 文件。

This project provides a local Windows workflow for generating, validating, and rendering exam answer deliverables for classroom display, printing, and reuse.

## 当前能力 / Capabilities

- 学科规则与运行配置使用 `subject-pack` 组织。
- 答案 Markdown 在渲染前执行格式与 LaTeX 基线校验。
- PDF 渲染保留真实数学公式输出，而不是降级为普通文本。
- 支持源 PDF 与答案 PDF 的页面审阅图生成。
- 支持作图题答案图的结构化描述、叠加层渲染与组合。
- WPF 桌面应用提供本地工具链入口和工作区诊断。

English summary:

- Subject policies and runtime profiles are organized as `subject-pack` assets.
- Answer Markdown is validated before rendering.
- PDF output keeps real LaTeX math rendering.
- Source PDFs and rendered answers can be reviewed through generated page images.
- Diagram-answer helpers support structured overlays and composition.
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
- `tools/answer-graphics/`: 作图题答案图提取、叠加和组合工具链。
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

执行本地冒烟检查：

```powershell
npm --prefix tools/latex-renderer run smoke
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

The junior-high physics answer workflow is currently the most complete path. Multi-subject support exists at the asset and contract level, while product-level coverage is still evolving.
