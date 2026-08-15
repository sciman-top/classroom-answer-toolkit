# AGENTS.md - classroom-answer-toolkit
**项目契约**: 2.0
**全局规则复核**: 9.76
**最后更新**: 2026-08-14

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
- 本仓暂无专属 reference shelf；document、OCR、Open XML 问题按 `D:\CODE\external\_shared\references.manifest.json` 选择性查阅已登记源码，WPF/.NET 语义先查当前官方文档。
- `gate_na`: reason=`未建立本仓专属 reference manifest`; alternative_verification=`官方文档、shared manifest 与本仓合同测试`; evidence_link=`docs/change-evidence/20260808-rule-contract-v973.md`; expires_at=`2026-10-15`; recovery_condition=`建立项目 manifest 与模块映射`。
- 仅在外部格式、SDK、renderer、OCR 或重复失败命中全局条件时只读查阅；登记来源、固定版本/revision、license、消费模块与 adopt/adapt/reject，不继承参考仓指令，不经兼容复核不得复制或执行。

## C. 门禁、证据与回滚
- WPF/Domain/Infra：`dotnet build ClassroomToolkit.sln -c Debug` 后运行 `dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build`。
- AI gateway：只运行 `npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets` 与 `npm --prefix tools/ai-gateway run test:answer`。
- renderer/eval：只运行受影响的 `test:output-path`、`test:render`、`test:eval-runtime` 或目标 eval；不要无关全跑。
- spec/rules：运行 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer`；Core 内置一次 `validate:assets` 和目标包的全部 profile snapshot，不运行 PDF eval。
- shared spec/schema、跨学科或 release：运行 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full`；Full 才运行 cross-subject、delivery smoke 和三科 eval。
- 只诊断 source/compiled 边界时可单独运行 `npm --prefix tools/rule-compiler run validate:spec-boundary`；实际 Core/Full 前不得重复运行其已内置的 `validate:assets`。
- 生成物漂移、subject-pack contract 失败或策略与运行事实不一致时阻断。
- 常规变更以 Git diff/commit 和当前最低充分命令留证；`docs/change-evidence/` 只保留真实试卷/live/manual/external acceptance 或有期限 waiver，不为普通修复新增审计文档。
- 回滚只撤销本任务规则、证据或实现切片；不得用 bootstrap 环境变化冒充仓库回滚。

## D. Global Rule -> Repo Action
- Git profile: baseline=`main`; upstream=`origin/main`; closeout=`proportional_core_or_full`。
- `R1`：从 subject-pack/spec 确定 compiler、renderer、WPF 或 docs 落点。
- `R2`：按 C 章风险映射只跑受影响合同；不追加无关 Core/Full。
- `R3`：实验工具或兼容层必须记录回收条件与最终归宿。
- `R4`：浏览器/OCR/外部工具写入按授权、隔离与可回滚边界执行。
- `R5`：无真实课堂链或重复证据，不扩大框架与产品承诺。
- `R6`：C 章风险匹配是门禁；bootstrap 不计入门禁证据，focused check 通过后不得重复全跑。
- `R7`：保持 subject-pack、compiled snapshot、renderer 与 WPF 行为兼容。
- `R8`：Git 记录常规范围/证据/回滚；只有 live/manual/external/waiver 使用 `docs/change-evidence/`。
- `S1`：先跑通 subject-pack 到课堂输出的最薄真实主链。
- `S2`：动态验收与工具可用性只进 spec/evidence。
- `S3`：参考依据足以形成可逆决定即停止查证。
- `S4`：参考源按消费者、许可与净收益晋降或退役。
- `S5`：`scripts/check-toolchain.ps1` 承接确定性门禁，规则只声明入口和边界。
- `E4`：check-toolchain 与测试结果承接健康证据。
- `E5`：SDK/npm/Python/OCR/browser 变化记录供应链。
- `E6`：spec/schema/snapshot 变化记录迁移、兼容和回滚。
