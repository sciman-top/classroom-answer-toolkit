# Classroom Answer Toolkit

本项目只解决一件事：把试卷生成的答案交付为符合课堂排版要求的 Markdown 和 PDF。

主链：

```text
试卷 PDF
  -> 页面图
  -> v8.14 完整提示词 + AI 作答
  -> 可选：参考答案 PDF 复核与校正
  -> Markdown 规则校验
  -> PDF 排版
  -> review 页图与 delivery manifest
```

本项目不是题库系统，不负责试卷入库、标签治理、知识图谱或样例飞轮。原卷与参考答案可以保留在用户自己的资料目录中；运行脚本接受任意明确路径，不要求把资料迁入项目资产结构。

## 当前状态

- 初中物理运行提示词：`prompts/junior-physics-answer/spec.md`，版本 `v8.14`。
- 已真实跑通 2025 广州中考原卷到 Markdown/PDF 的完整链路。
- 单次整卷盲答仍可能在视觉题、接线题和多小问覆盖上出错，不能未经参考答案或人工复核直接声明可信。
- 2025 实跑交付位于 `正式交付/2025广州中考/`，原卷目录 `广州物理中考试卷/` 保持为用户资料，不纳入仓库资产治理。

## 最短运行

从原卷直接生成并排版：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-live-answer-workflow.ps1 `
  -SourcePdf "广州物理中考试卷/2025广州中考.pdf" `
  -ReferencePdf "广州物理中考试卷/2025广州中考（答案）.pdf" `
  -OutputDirectory "正式交付/2025广州中考" `
  -KeepReview
```

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
- `prompts/junior-physics-answer/`：v8.14 运行提示词、规则、排版 profile 和 manifest。
- `tools/ai-gateway/`：显式云出网的答案生成请求。
- `tools/rule-compiler/`：subject-pack、规则和 snapshot 编译与校验。
- `tools/latex-renderer/`：Markdown 校验、PDF 渲染、review 页图和交付 manifest。
- `scripts/run-live-answer-workflow.ps1`：真实原卷主链入口。
- `src/`：WPF 桌面入口，只承载主链操作和状态展示。
- `eval/*-answer/`：答案内容和排版的固定回归。

## 验证

固定顺序：

```powershell
dotnet build ClassroomToolkit.sln -c Debug
dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug
npm --prefix tools/rule-compiler run validate:assets
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1
```

`scripts/bootstrap.ps1` 会安装依赖，只用于环境初始化，不是日常门禁。

## 可信边界

`delivery-manifest.json` 证明的是指定 snapshot、Markdown、PDF 和 review 产物之间的交付关系，不证明答案语义必然正确。答案可信需要满足以下至少一项：

- 与权威参考答案逐题比对并完成校正；
- 由教师逐题复核；
- 后续自动比对能力给出可审计差异，并由规则或人工处理未决项。

继续扩写 100 KB 级主提示词不是当前主要优化方向。优先级是参考答案复核、局部高清题图、遗漏检测和真实试卷回归。
