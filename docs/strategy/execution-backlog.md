# Execution Backlog

## Epic 1: 文档真值收口

### task_id: DOC-001

- goal: 建立 `prompts/specs/README.md` 并固定目录职责
- inputs: 当前 `prompts/specs/` 目录与既有规范文件
- changes: 新增 README，声明 source/generate 边界
- verification: README 存在，职责与路径完整
- rollback: 删除新增 README 并恢复旧说明
- blocks: 无
- done_definition: 后续 AI 能只凭 README 确定规范真值区

### task_id: DOC-002

- goal: 建立 `docs/strategy/README.md` 作为唯一规划入口
- inputs: 根目录现有路线图、任务清单文档
- changes: 新增 strategy 目录入口，列 authoritative 文档
- verification: README 存在，链接均可打开
- rollback: 移除新 README
- blocks: 无
- done_definition: 根目录不再作为路线图真值入口

## Epic 2: human spec 汇编

### task_id: SPEC-001

- goal: 新增 assembler，自动生成完整版、调用版与 `spec.md`
- inputs: `assemblies/*.json` 与源规范
- changes: 新增 `tools/spec-assembler/`
- verification: 重新生成后 generated 文件无 diff
- rollback: 移除 assembler 与生成流程
- blocks: `assemblies/` 已定义
- done_definition: generated 文件不再手工维护

## Epic 3: 多学段物理迁移

### task_id: PACK-001

- goal: `physics-answer` 迁到 `junior-physics-answer`
- inputs: 当前 prompts/eval/code/tests 中全部 `physics-answer` 引用
- changes: 目录、assetId、eval 路径、CLI 默认值与 UI 默认值迁移
- verification: `validate-assets`、`dotnet test`、`validate:answer`、`deliver` 全通过
- rollback: 恢复旧目录与旧 assetId
- blocks: assembler 与 compiled human spec 已就位
- done_definition: 平台不再把初中物理硬编码成唯一主线

### task_id: PACK-002

- goal: 新增 `senior-physics-answer` 模板包
- inputs: `junior-physics-answer`、高中物理源规范
- changes: 新建 manifest/config/rules/profiles/eval 模板
- verification: snapshot 与 assets 校验通过
- rollback: 删除新增模板包
- blocks: PACK-001
- done_definition: 高中物理可在不重构平台 contract 的前提下接入

## Epic 4: 视觉降错

### task_id: VISION-001

- goal: 固定双轨与高风险复核规则
- inputs: `visual-first-answering-architecture.md`、图文定量题通用规范
- changes: 规则文档、策略文档、回归样例标签
- verification: 文档与样例都能表达双轨/哨兵/抽检策略
- rollback: 恢复旧单轨叙述
- blocks: 无
- done_definition: 看图风险被明确建模，而不是只靠提示词提醒

## Epic 5: 受控插图收缩

### task_id: GRAPHICS-001

- goal: 将 `answer-graphics` 从主需求降级为实验性受控插图底座
- inputs: README、strategy、ADR、bootstrap/check-toolchain、桌面诊断口径
- changes: 去掉自动作图答案图承诺；保留“已有图块插入 PDF”能力；主链门禁不再依赖 `tools/answer-graphics`
- verification: 文档口径一致；主链 bootstrap/check 不再把 `answer-graphics` 视为硬门禁
- rollback: 恢复旧主需求表述与门禁
- blocks: 无
- done_definition: 后续 AI 不会再把自动作图答案图当作主线承诺
