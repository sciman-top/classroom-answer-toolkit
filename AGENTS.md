# AGENTS.md - classroom-answer-toolkit
**项目契约**: 2.0
**全局规则复核**: 9.77
**最后更新**: 2026-08-19

## 1. 当前落点与目标归宿
- 当前落点：本仓实现课堂参考答案生成、渲染、验证与交付工具链。
- 目标归宿：以可维护的 WPF 应用和可版本化 subject-pack 合同稳定交付多学科答案资产。
- 下一最小里程碑：从 `docs/strategy/README.md` 与 `execution-backlog.md` fresh read 首个可执行切片；历史证据只在当前基准或 waiver 精确引用时读取，未验收不得外推。

## A. 仓库事实与模块边界
- `docs/strategy/` 是规划真源；先读 `README.md`、`product-prd.md` 与 `final-implementation-baseline.md`。
- `prompts/specs/` 是人类规范真源，只手改 `platform/`、`commons/`、`subjects/`；`prompts/specs/compiled/`、`prompts/<subject-pack>/spec.md` 和 `snapshot` 是生成或运行真相，禁止手改。
- `ClassroomToolkit.sln`、`src/`、`tests/` 承载 App/Domain/Infra 三项目 WPF、编排与 xUnit 合同；无独立发布或变化率证据不得恢复 Application/Services 空壳程序集。
- retained `tools/` 为 spec-assembler、rule-compiler、ai-gateway、latex-renderer 与按需 OCR；visual-evidence、sample-flywheel、review-queue、synthetic visual 和 answer-graphics 已从 active tree 删除。`tmp/`、`.answer-graphics/` 与旧根提示词只由 Git 历史追溯，不得重新提交。
- 真实主链是“人类 spec -> compile/snapshot -> 答案生成 -> renderer -> 资产合同 -> 教师复核交付”；先跑通一个 subject-pack 的最薄闭环，再扩学科或恢复实验工具。

## B. 执行与风险边界
- `scripts/bootstrap.ps1` 会安装 SDK 或依赖，只是 setup 入口，不是日常验证门禁。
- 保持 4 空格、.NET `PascalCase`/`camelCase` 与 kebab-case subject/tool ID。
- schema、runtime、renderer、WPF 或生成合同变化必须同步人类真源、生成物验证和兼容证据，不得只改 compiled 输出。
- Markdown 规则只指导真源和风险；生成物不可手改、subject-pack 合同与交付阻断由 assembler/compiler、测试和 `scripts/check-toolchain.ps1` 强制。

### B.1 参考依据与外置源码
- 本仓按设计不维护专属 reference shelf；document、OCR、Open XML 问题按 `D:\CODE\external\_shared\references.manifest.json` 选择性查阅已登记源码，WPF/.NET 语义先查当前官方文档。
- 仅在外部格式、SDK、renderer、OCR 或重复失败命中全局条件时只读查阅；登记来源、固定版本/revision、license、消费模块与 adopt/adapt/reject，不继承参考仓指令，不经兼容复核不得复制或执行。

## C. 门禁、证据与回滚
- WPF/Domain/Infra：`dotnet build ClassroomToolkit.sln -c Debug` 后运行 `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build --filter "Gate!=ToolchainIntegration"`。
- workflow、publish、packaging 或 Node CLI 合同：运行 `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build --filter "Gate=ToolchainIntegration"`；release 可与普通 .NET 测试各运行一次。
- AI gateway：只运行 `npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets` 与 `npm --prefix tools/ai-gateway run test:answer`。
- renderer/eval：只运行受影响的 `test:output-path`、`test:render`、`test:eval-runtime` 或目标 eval；不要无关全跑。
- spec/rules：运行 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer`；Core 内置一次 `validate:assets` 和目标包的全部 profile snapshot，不运行 PDF eval。
- shared spec/schema、跨学科或 release：运行 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full`；Full 才运行 cross-subject、廉价 delivery manifest 合同和三科 eval。
- 只诊断 source/compiled 边界时可单独运行 `npm --prefix tools/rule-compiler run validate:spec-boundary`；实际 Core/Full 前不得重复运行其已内置的 `validate:assets`。
- 生成物漂移、subject-pack contract 失败或策略与运行事实不一致时阻断。
- 常规变更以 Git diff/commit 和当前最低充分命令留证；`docs/change-evidence/` 只保留真实试卷/live/manual/external acceptance 或有期限 waiver，不为普通修复新增审计文档。

## D. Git 与回滚
- Git baseline=`main`; upstream=`origin/main`; closeout=`proportional_core_or_full`。
- 回滚只撤销本任务规则、证据或实现切片；不得用 bootstrap 环境变化冒充仓库回滚。
