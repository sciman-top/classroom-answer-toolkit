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
- 已落地离线 `DeliveryQuestionCoverage -> DeliveryDecisionAggregate` 编译器、受控 aggregate manifest 附着和 preimage/result receipt；WPF 可由用户显式选择本地 aggregate，附着成功后立即 source-aware 重验，并只投影与 `manifestResultSha256` 绑定的时间点状态。
- 已把 QQ 重链路经验移植为阶段化视觉证据产物：`VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` 通过 `TrackResult.stageArtifactRefs` 接入，并新增 `unsafe_shortcut_fail` fail-closed 样例。
- 已落地可选 AI 网关配置校验入口、文本请求主备切换和显式视觉 TrackResult 探针；云外发默认关闭，真实密钥只保留在本地 `.env`。
- 已用 VISION-007 renderer 的显式文字/坐标声明建立三学科 synthetic OCR diagnostic：报告可重算 exact-text 漏检、误检和 unavailable 分母，但不构成人工 truth、真实 OCR benchmark 或 OCR acceptance。
- 已为三份公开 synthetic 2x crop 建立机器等效视觉复核 receipt：AI 复核只在 `synthetic_fixture_diagnostic` 范围内等效人工检查，身份始终记录为 `reviewerKind=ai_agent`、`humanReviewed=false`，不构成人类身份、delivery trust 或 live acceptance。
- 已在 VISION-008/009/010 authority 上建立 deterministic OCR-region association policy diagnostic：当前 frozen fixtures 诚实报告两例 unavailable、一例 unmatched、零 canonical match；正向与歧义只作非权威 policy 回归，不构成 OCR correctness、layout semantics 或 Track B。
- WPF 已能在一次答案交付后投影最新 delivery manifest 的 review lifecycle、视觉复核和 trust 状态，并通过 fail-closed 工具附着、刷新和打开本地 JSON `DecisionRecord`；还可对用户显式选择且通过 source-aware 重验的本地 review artifact 做三类只读队列投影。审批生成、lifecycle 回写和原题生成主链仍未接入。
- 已落地自动解题工作站终局计划与 Typst 主渲染迁移计划；当前运行时仍保持 Playwright / Chromium。
- 支持实验性的受控插图插入链路，可把用户提供或人工复核后的答案图块插入 PDF。
- WPF 桌面应用提供本地工具链入口和工作区诊断。

English summary:

- Subject policies and runtime profiles are organized as `subject-pack` assets.
- Answer Markdown is validated before rendering.
- PDF output keeps real LaTeX math rendering.
- Source PDFs and rendered answers can be reviewed through generated page images.
- Visual-evidence compiler schemas and a minimal offline `DecisionRecord` compiler define evidence chains, track results, risk labels, and review/trust decisions.
- An offline `DeliveryQuestionCoverage -> DeliveryDecisionAggregate` compiler verifies byte hashes, snapshot binding, sample-package question inventory, and per-question decisions. A controlled CLI can attach that aggregate with a preimage/result receipt; WPF can explicitly attach a local aggregate, immediately reverify it, and project only a hash-bound point-in-time result, while ordinary WPF reads, diagnostics, and headless consumers remain fail-closed.
- QQ heavy-chain lessons are now mapped into staged visual artifacts: `VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` are referenced through `TrackResult.stageArtifactRefs`, with an `unsafe_shortcut_fail` fail-closed fixture.
- Optional AI gateway config validation, text failover, and explicit vision TrackResult probes are available; cloud egress is disabled by default and real keys stay in local `.env`.
- After a delivery, WPF can project the latest manifest's review lifecycle, visual-review, and trust state and use a fail-closed tool to attach, refresh, and open a local JSON `DecisionRecord`. It can also build a read-only three-lane queue from explicitly selected, source-reverified local review artifacts. Approval generation, lifecycle write-back, and source-question generation remain open.
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
- `tools/visual-evidence/`: 视觉证据 `DecisionRecord`、交付级 coverage/aggregate 离线编译、受控 manifest 附着与 fail-closed 合同测试。
- `tools/sample-flywheel/`: 合成样例的 index/package 准入、plumbing/scoring 门禁、`SampleRunRecord` 编译、fixture/teacher-text `FeedbackParseResult` 归因，以及独立 teacher ingestion/replay diagnostic report；当前 scoring 只做 SHA-256 exact-diff。
- `tools/answer-graphics/`: 实验性受控插图工具链，不是默认主交付链。
- `tools/ocr/`: 面向低质量扫描件和批量处理的本地 OCR 路径。
- `tools/visual-ocr-diagnostics/`: 对 generator-declared synthetic text truth 与 canonical OCR observations 做本地、确定性、禁云诊断。
- `tools/visual-text-region-diagnostics/`: 对同一 synthetic truth 与 canonical heuristic text-region candidates 做本地、确定性、禁云空间覆盖诊断。
- `tools/visual-machine-review/`: 校验 synthetic crop 的机器视觉复核 receipt、上游 raw-byte/pixel/dimension authority、已披露限制和 fail-closed 状态边界。
- `tools/visual-ocr-region-association/`: 对 canonical text-region/OCR/spatial authority 应用双向唯一 positive-area association policy，并按学科报告 matched/unmatched/ambiguous/unavailable。
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
npm --prefix tools/visual-evidence run test:aggregate
npm --prefix tools/visual-evidence run compile:aggregate -- --manifest "<delivery-manifest.json>" --coverage "<delivery-question-coverage.json>" --decision "<decision-record.json>" --out "<delivery-decision-aggregate.json>"
npm --prefix tools/visual-evidence run attach:decision -- --manifest "<delivery-manifest.json>" --decision "<decision-record.json>"
npm --prefix tools/visual-evidence run attach:aggregate -- --manifest "<delivery-manifest.json>" --aggregate "<delivery-decision-aggregate.json>"
npm --prefix tools/visual-evidence run verify:aggregate-attachment -- --manifest "<delivery-manifest.json>"
npm --prefix tools/sample-flywheel test
npm --prefix tools/sample-flywheel run compile:run -- --sample-id "<sample-id>" --run-mode scoring --candidate "<indexed-negative-candidate.json>" --truth-extraction-status ok --input-answer-leakage none --iteration 1 --out "<sample-run-record.json>"
npm --prefix tools/sample-flywheel run compile:feedback -- --run "<sample-run-record.json>" --created-at "<canonical-utc-timestamp>" --out "<feedback-parse-result.json>"
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
样例飞轮现已具备完全合成 fixture 的可执行准入、记账与反馈归因闭环：`样例交付/index.json` 是不可覆盖的 canonical authority，并通过 `subjectPack / packageRef / packageSha256` 绑定唯一 structured package，通过 `candidateBindings` 绑定 negative-candidate descriptor bytes；hash-bound 样例资产由 `.gitattributes` 固定 LF。package 与内部引用必须留在对应 canonical root。`plumbing` 不产优化信号，`scoring` 要求显式 candidate/truth/leakage 状态并受 fail-closed 门禁约束；current-authority-valid、non-exact fixture-labelled scoring run 可编译 auto feedback，canonical public synthetic teacher text 可经有限显式词典投影为 parsed 或 `needs_human_label`。独立 ingestion diagnostic 统计结构化率与分流分布，独立 replay diagnostic 统计当前 parser 对冻结 expected result raw bytes 的回放兼容率。输出通过仓内有限 shape validator、compiler semantic invariants 和当前 canonical authority bytes 重验，不代表完整 Draft 2020-12、真实教师自由文本理解、任意归档 authority 或语义答案评分；teacher diagnostics 不进入 candidate readiness，`optimizationCandidateRefs` 仍为空，不构成优化候选或灰度放行。
视觉降错本轮已进入契约层并具备最小离线决策编译：`NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord` 已纳入 schema 与资产校验，`VisualInputBundle / GroundingSnapshot / SolutionSnapshot / ConsistencyReport` 已作为阶段产物落盘，双轨一致但证据缺失和直接跳答案缺 grounding 的样例都可由运行时代码推导为 `trusted=false`；真正的双轨/三轨运行时和局部高清 crop 仍是后续工程。
三份公开 synthetic crop 另有 generator-declared text truth 与独立 OCR diagnostic report：当前 math/senior fixture 暴露漏检，junior fixture 暴露误检。该结果只说明冻结 fixture 上的 repo-side diagnostics，不是人工标注、真实 OCR 质量、layout semantics、Track B 或 live acceptance。
同三份 synthetic crop 已由 AI 完成可追溯的机器视觉复核，并在该 synthetic diagnostic scope 内作为等效人工检查；canonical receipt 仍明确 `humanReviewed=false`、`humanIdentityDisposition=not_claimed`，不会投影 delivery trust、WPF workflow 或 live acceptance，也不验证 readiness controls 或产生 `OptimizationCandidate`。
同一 authority 的 OCR-region association diagnostic 当前输出 math/senior unavailable、junior unmatched、零 matched。该结果只证明 fail-closed policy plumbing；policy 单元测试中的正向 geometry 不是 canonical fixture 或样本 truth，不能升级为 OCR/layout/Track B、workflow 或 live acceptance。
WPF 当前完成最新交付的 review/trust 投影、本地题目级 `DecisionRecord` 的受控附着、本地 aggregate 的显式附着后立即重验，以及 `needs_human_label / high_risk_approval / truth_needs_review` 三类本地只读队列投影。队列只消费用户显式选择且通过 canonical path、raw-byte SHA-256 与既有 source-aware verifier 重验的 artifact；任一 rejected source 会清空本次投影。该入口不生成 aggregate/审批、不推进 lifecycle、不修改 trust；这不等于视觉网关已接入默认答题流程，也不等于完整 workflow 或 live acceptance 已完成。
离线 delivery aggregate 已能对合成 `sample-package` inventory、snapshot/input/manifest bytes 和逐题决策做完整覆盖证明，并记录 aggregate attach 的可重验 hash chain；它仍不代表真实试卷全题识别、WPF workflow integration 或 live acceptance。
自动解题工作站和 Typst 主渲染已作为终局计划落盘；Typst 未通过 parity gate 前，默认交付链仍是 Playwright / Chromium。
自动基于题图生成作图题答案图不再作为本项目的主需求；当前只保留“受控插图插入 PDF”的实验性底座。

The junior-high physics answer workflow is currently the most complete path. Multi-subject support exists at the asset and contract level, while product-level coverage is still evolving.
