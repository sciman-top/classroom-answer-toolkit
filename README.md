# Classroom Answer Toolkit

本项目只解决一件事：把试卷生成的答案交付为符合课堂排版要求的 Markdown 和 PDF。

主链：

```text
试卷 PDF
  -> 页面图
  -> v8.15 完整提示词 + AI 作答
  -> 4x 题目级左右重叠视窗 + 无参考答案视觉审计
  -> 可选：参考答案 PDF 复核与校正
  -> Markdown 规则校验
  -> PDF 排版
  -> review 页图与 delivery manifest
```

本项目不是题库系统，不负责试卷入库、标签治理、知识图谱或样例飞轮。原卷与参考答案可以保留在用户自己的资料目录中；运行脚本接受任意明确路径，不要求把资料迁入项目资产结构。

## 当前状态

- 初中物理运行提示词：`prompts/junior-physics-answer/spec.md`，版本 `v8.15`。
- 已真实跑通 2025 广州中考原卷到 Markdown/PDF 的完整链路。
- 默认主链不再把单次整卷盲答直接送去排版：先以 4x 重渲染原卷，按 PDF.js 题号切成每题两个带重叠的高清视窗（续页继承题号）执行独立视觉审计，再进入可选参考答案复核。
- 局部高清审计能降低滑轮、刻度尺和钩码计数错误，但不能保证消除所有仪表盘歧义；未经参考答案或人工复核仍不得声明答案可信。
- 2024/2025 实跑交付位于 `正式交付/`；仓内 `广州物理中考试卷/` 是明确版本化的广州真题 golden corpus。其他用户原卷仍可从任意路径输入，无需复制进仓库。
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
- `prompts/junior-physics-answer/`：v8.15 运行提示词、规则、排版 profile 和 manifest。
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
dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build

# subject-pack spec / rules
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer
```

AI gateway、renderer 和 eval 改动运行各自 package 的 focused Node 测试。Core 只做联合资产合同与目标 subject-pack 的 profile snapshot，通常数秒完成；不再捆绑无关 gateway/renderer 测试或 PDF eval。共享 spec/schema、跨学科或 release 变化才使用 `-Mode Full`。Core/Full 已内置一次 `validate:assets`，不要在外层重复执行。

Full 中共享 renderer/layout 回归只由 `junior-physics-answer` 承担一次；Senior/Math 仍使用各自 snapshot 和独有 sentinel，不能把共享回归去重解释为跳过跨学科合同。

`scripts/bootstrap.ps1` 会安装基础依赖，只用于环境初始化，不是日常门禁；确需 RapidOCR 时显式增加 `-WithOcr`。

## 可信边界

`delivery-manifest.json` 证明的是指定 snapshot、Markdown、PDF 和 review 产物之间的交付关系，不证明答案语义必然正确。答案可信需要满足以下至少一项：

- 与权威参考答案逐题比对并完成校正；
- 由教师逐题复核；
- 后续自动比对能力给出可审计差异，并由规则或人工处理未决项。

继续扩写 100 KB 级主提示词不是当前主要优化方向。优先级是参考答案复核、局部高清题图、遗漏检测和真实试卷回归。
