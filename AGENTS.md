# AGENTS.md - classroom-answer-toolkit
**项目契约**: 2.0
**全局规则复核**: 9.56
**最后更新**: 2026-07-14

## 1. 当前落点与目标归宿
- 当前落点：本仓实现课堂参考答案生成、渲染、验证与交付工具链。
- 目标归宿：以可维护的 WPF 应用和可版本化 subject-pack 合同稳定交付多学科答案资产。
- 下一最小里程碑：按 `docs/strategy/final-implementation-baseline.md` 完成当前有界 slice，并保持生成物与人类真源一致。

## A. 仓库事实与模块边界
- `docs/strategy/` 是规划/执行真源；先读 `README.md`、`product-prd.md` 与 `final-implementation-baseline.md`。
- `prompts/specs/` 是人类规范真源；只手改 `platform/`、`commons/`、`subjects/`。
- `prompts/specs/compiled/` 与 `prompts/<subject-pack>/spec.md` 是生成物，禁止手改；`snapshot` 是交付、验证和诊断运行真相。
- `ClassroomToolkit.sln`、`src/`、`tests/` 承载 WPF/编排/领域/基础设施与 xUnit 合同。
- `tools/` 承载 latex-renderer、rule-compiler、visual-evidence、ai-gateway、ocr；`answer-graphics` 仍是实验面，不得无决策记录升级为默认承诺。

## B. 执行与风险边界
- `scripts/bootstrap.ps1` 会安装 SDK/依赖，只是 setup 入口，不是日常验证门禁；未经明确需要不得为规则/文档改动运行。
- 保持 4 空格、.NET `PascalCase`/`camelCase` 与 kebab-case subject/tool ID。
- 根规划 Markdown 只作跳转壳；不得把权威策略文本搬回根目录。
- schema、runtime、renderer、WPF 或生成合同变化必须更新人类真源、生成物验证和兼容证据；不得只改 compiled 输出。

## C. 门禁、证据与回滚
- fixed order：`build -> test -> contract/invariant -> hotspot`。
- agent-rule contract CI：`.github/workflows/agent-rule-contract.yml` 只验证规则契约，不替代本仓产品门禁。
- build：`dotnet build ClassroomToolkit.sln -c Debug`
- test：`dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug`
- contract/invariant：`npm --prefix tools/rule-compiler run validate:assets`
- hotspot：`pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1`，覆盖跨学科、gateway、visual evidence、renderer 与 eval 热点。
- quick feedback：按改动范围运行单个 xUnit/Node 测试；交付前仍执行完整固定顺序。
- 生成物漂移、subject-pack contract 失败、策略/README 与运行事实不一致时阻断。
- 证据放入 `docs/change-evidence/`；记录风险、命令、exit code、关键输出、兼容性、N/A 和回滚。
- 回滚只撤销本任务 `AGENTS.md / CLAUDE.md / evidence` 或对应实现切片；不得用 bootstrap 造成的本机环境变化冒充仓库回滚。

## D. Global Rule -> Repo Action
- `R1-R5`：从策略真源确定落点与 slice，小步验证；不把实验工具提前扩成产品承诺。
- `R6`：C 章四阶段是硬门禁，bootstrap 不计入 build/test 证据。
- `R7`：保持 subject-pack、compiled snapshot、renderer 与 WPF 行为兼容。
- `R8`：handoff 必须给出范围、命令、证据路径与回滚面。
- `E4`：check-toolchain 与测试承接健康；`E5`：SDK/npm/Python/OCR/browser 变化记录供应链；`E6`：spec/schema/snapshot 变化记录迁移、兼容和回滚。
