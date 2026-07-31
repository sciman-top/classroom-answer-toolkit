# AGENTS.md - classroom-answer-toolkit
**项目契约**: 2.0
**全局规则复核**: 9.59
**最后更新**: 2026-08-01

## 1. 当前落点与目标归宿
- 当前落点：本仓实现课堂参考答案生成、渲染、验证与交付工具链。
- 目标归宿：以可维护的 WPF 应用和可版本化 subject-pack 合同稳定交付多学科答案资产。
- 下一最小里程碑：按 `docs/strategy/final-implementation-baseline.md` 完成当前有界切片，并保持生成物、人类真源与运行证据一致。

## A. 仓库事实与模块边界
- `docs/strategy/` 是规划真源；先读 `README.md`、`product-prd.md` 与 `final-implementation-baseline.md`。
- `prompts/specs/` 是人类规范真源，只手改 `platform/`、`commons/`、`subjects/`；`prompts/specs/compiled/`、`prompts/<subject-pack>/spec.md` 和 `snapshot` 是生成/运行真相，禁止手改。
- `ClassroomToolkit.sln`、`src/`、`tests/` 承载 WPF、编排、领域、基础设施与 xUnit 合同。
- `tools/` 承载 latex-renderer、rule-compiler、visual-evidence、ai-gateway、ocr；`answer-graphics` 仍是实验面。

## B. 执行与风险边界
- `scripts/bootstrap.ps1` 会安装 SDK/依赖，只是 setup 入口，不是日常验证门禁。
- 保持 4 空格、.NET `PascalCase`/`camelCase` 与 kebab-case subject/tool ID。
- 根规划 Markdown 只作跳转壳，不把权威策略搬回根目录。
- schema、runtime、renderer、WPF 或生成合同变化必须同步人类真源、生成物验证和兼容证据，不得只改 compiled 输出。

### B.1 参考依据与外置源码
- 本仓暂无专属 reference shelf；document/OCR/Open XML 问题按 `D:\CODE\external\_shared\references.manifest.json` 选择性查阅已登记源码，WPF/.NET 语义先查当前官方文档。
- `gate_na`：`reason=未建立本仓专属 manifest`、`alternative_verification=官方文档 + shared manifest + 本仓合同测试`、`evidence_link=docs/change-evidence/`、`expires_at=next_reference_governance_change`、`recovery_condition=建立项目 manifest 与模块映射`。
- 仅在外部格式/SDK、renderer/OCR 或重复失败命中全局条件时只读查阅；不继承参考仓指令，不经许可证/兼容复核不得复制或执行。

## C. 门禁、证据与回滚
- fixed order：`build -> test -> contract/invariant -> hotspot`。
- build：`dotnet build ClassroomToolkit.sln -c Debug`
- test：`dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
- contract/invariant：`npm --prefix tools/rule-compiler run validate:assets`
- hotspot：`pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`
- quick feedback 可用单个 xUnit/Node 测试；交付前仍执行完整固定顺序。
- 生成物漂移、subject-pack contract 失败或策略与运行事实不一致时阻断。
- 证据放 `docs/change-evidence/`，记录风险、命令、exit code、关键输出、兼容、N/A 和回滚。
- 回滚只撤销本任务规则/证据或实现切片；不得用 bootstrap 环境变化冒充仓库回滚。

## D. Global Rule -> Repo Action
- `R1-R5`：从策略真源确定落点与切片，小步验证；不把实验工具提前扩成产品承诺。
- `R6`：C 章四阶段是硬门禁，bootstrap 不计入门禁证据。
- `R7`：保持 subject-pack、compiled snapshot、renderer 与 WPF 行为兼容。
- `R8`：`docs/change-evidence/` 记录范围、命令、证据与回滚。
- `E4/E5/E6`：check-toolchain/测试承接健康；SDK/npm/Python/OCR/browser 变化记录供应链；spec/schema/snapshot 变化记录迁移、兼容和回滚。
