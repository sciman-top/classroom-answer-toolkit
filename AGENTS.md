# AGENTS.md - classroom-answer-toolkit
**项目契约**: 2.0
**全局规则复核**: 9.62
**最后更新**: 2026-08-03

## 1. 当前落点与目标归宿
- 当前落点：本仓实现课堂参考答案生成、渲染、验证与交付工具链。
- 目标归宿：以可维护的 WPF 应用和可版本化 subject-pack 合同稳定交付多学科答案资产。
- 下一最小里程碑：对指定 2024/2025 交付物开展教师复核并记录 `teacher_accepted`；保持 `VISION-101` blocked，直到真实标注 authority、稳定 provider endpoint 与四类对象预算条件全部满足。

## A. 仓库事实与模块边界
- `docs/strategy/` 是规划真源；先读 `README.md`、`product-prd.md` 与 `final-implementation-baseline.md`。
- `prompts/specs/` 是人类规范真源，只手改 `platform/`、`commons/`、`subjects/`；`prompts/specs/compiled/`、`prompts/<subject-pack>/spec.md` 和 `snapshot` 是生成或运行真相，禁止手改。
- `ClassroomToolkit.sln`、`src/`、`tests/` 承载 App/Domain/Infra 三项目 WPF、编排与 xUnit 合同；无独立发布或变化率证据不得恢复 Application/Services 空壳程序集。
- retained `tools/` 为 spec-assembler、rule-compiler、ai-gateway、latex-renderer 与按需 OCR；visual-evidence、sample-flywheel、review-queue、synthetic visual 和 answer-graphics 已从 active tree 删除。`tmp/`、`.answer-graphics/` 与旧根提示词只由 Git 历史追溯，不得重新提交。

## B. 执行与风险边界
- `scripts/bootstrap.ps1` 会安装 SDK 或依赖，只是 setup 入口，不是日常验证门禁。
- 保持 4 空格、.NET `PascalCase`/`camelCase` 与 kebab-case subject/tool ID。
- 根规划 Markdown 只作跳转壳，不把权威策略搬回根目录。
- schema、runtime、renderer、WPF 或生成合同变化必须同步人类真源、生成物验证和兼容证据，不得只改 compiled 输出。

### B.1 参考依据与外置源码
- 本仓暂无专属 reference shelf；document、OCR、Open XML 问题按 `D:\CODE\external\_shared\references.manifest.json` 选择性查阅已登记源码，WPF/.NET 语义先查当前官方文档。
- `gate_na`：`reason=未建立本仓专属 manifest`、`alternative_verification=官方文档 + shared manifest + 本仓合同测试`、`evidence_link=docs/change-evidence/`、`expires_at=next_reference_governance_change`、`recovery_condition=建立项目 manifest 与模块映射`。
- 仅在外部格式、SDK、renderer、OCR 或重复失败命中全局条件时只读查阅；不继承参考仓指令，不经许可证和兼容复核不得复制或执行。

## C. 门禁、证据与回滚
- fixed order：`build -> test --no-build -> risk-matched toolchain gate`；Core/Full 内部先执行一次 contract/invariant，再执行其余 hotspot，禁止在外层重复跑资产合同。
- build：`dotnet build ClassroomToolkit.sln -c Debug`
- test：`dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug --no-build`
- core：`pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Core -SubjectPack junior-physics-answer`；内置且只执行一次 `validate:assets`。
- full：shared spec/schema、renderer、release 或跨学科变化使用 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1 -Mode Full`。
- contract-only：仅需定向检查资产合同时可单独运行 `npm --prefix tools/rule-compiler run validate:assets`，不得随后再把它计作 Core/Full 的额外必跑前置。
- fast：局部反馈可用 focused xUnit/Node 或 `-Mode Fast`；Fast 只跑轻量 spec boundary，不替代内置完整合同的 Core/Full。
- 生成物漂移、subject-pack contract 失败或策略与运行事实不一致时阻断。
- 证据放 `docs/change-evidence/`，记录风险、命令、exit code、关键输出、兼容、N/A 和回滚。
- 回滚只撤销本任务规则、证据或实现切片；不得用 bootstrap 环境变化冒充仓库回滚。

## D. Global Rule -> Repo Action
- `R1-R5`：从策略真源确定落点与切片，小步验证；不把实验工具提前扩成产品承诺。
- `R6`：C 章顺序和风险匹配是硬门禁，bootstrap 不计入门禁证据。
- `R7`：保持 subject-pack、compiled snapshot、renderer 与 WPF 行为兼容。
- `R8`：`docs/change-evidence/` 记录范围、命令、证据与回滚。
- `E4/E5/E6`：check-toolchain/测试承接健康；SDK/npm/Python/OCR/browser 变化记录供应链；spec/schema/snapshot 变化记录迁移、兼容和回滚。
