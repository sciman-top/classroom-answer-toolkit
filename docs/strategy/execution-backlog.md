# Execution Backlog

## Epic DOC：文档真值收口

### task_id: DOC-001

- goal: 新增产品 PRD、最终实施基线和实施计划
- inputs: `docs/strategy/` 现有文档、产品评审结论
- changes: 新增 `product-prd.md`、`final-implementation-baseline.md`、`implementation-plan.md`
- verification: 三个文件存在，阅读顺序与职责边界清楚
- rollback: 删除新增文件并恢复旧入口说明
- blocks: 无
- done_definition: 仓内出现单一的产品/实现/执行三层真值面

### task_id: DOC-002

- goal: 收口 `docs/strategy/README.md` 为唯一规划入口
- inputs: `docs/strategy/` 全部 authoritative 文档
- changes: 重写 README，固定阅读顺序与使用规则
- verification: README 可直接引导新接手者定位全部真值文档
- rollback: 恢复旧 README
- blocks: DOC-001
- done_definition: 根目录不再承担规划正文入口

### task_id: DOC-003

- goal: 同步根目录跳转壳与 archive 说明
- inputs: 根目录旧规划壳、`docs/archive/README.md`
- changes: 更新根目录跳转壳、archive 边界说明
- verification: 根目录不再出现新的长规划正文
- rollback: 恢复旧壳文件
- blocks: DOC-002
- done_definition: 外部入口不会再误导到历史正文

## Epic SPEC：schema 与规范治理

### task_id: SPEC-001

- goal: 固定高频变化规范治理终态
- inputs: `prompts/specs/README.md`、`assemblies/`、现有 schema
- changes: 更新 `spec-evolution-adaptation-plan.md` 与 `prompts/specs/README.md`
- verification: 规范真值区与规划真值区边界一致
- rollback: 恢复原文档
- blocks: DOC-001
- done_definition: `$id`、compatibility、impact analysis、回滚口径被文档化

### task_id: SPEC-002

- goal: 定义样例真值面 schema 集
- inputs: `样例交付/`、现有 schema 面、飞轮设计
- changes: 在实施基线中固定 `sample-package / sample-index / negative-candidate / sample-run-record`
- verification: 字段形状、候选来源、配对入口清楚
- rollback: 恢复旧方案口径
- blocks: SPEC-001
- done_definition: 样例真值面不再依赖口头约定

## Epic SAMPLE：样例真值面与负样本

### task_id: SAMPLE-001

- goal: 固定 structured 样例包与 flat index 边界
- inputs: `样例交付/` 现状、飞轮输入需求
- changes: 在实施基线与 roadmap 中固定 `structured/` 与 `index.json` 角色
- verification: flat scoring 只能通过 `index.json` 入场
- rollback: 恢复旧“自动发现文件”口径
- blocks: SPEC-002
- done_definition: 样例配对真值入口唯一

### task_id: SAMPLE-002

- goal: 固定负样本来源与验收门槛
- inputs: 4 份参考答案 Markdown、历史候选、扰动负样本规则
- changes: 在 backlog 与实施基线中定义 `perturbed_negative / historical_candidate / generated`
- verification: 分桶门槛与验收口径一致
- rollback: 恢复旧总量指标口径
- blocks: SAMPLE-001
- done_definition: synthetic 负样本不再能单独推动放行

## Epic FLYWHEEL：sample-run / feedback / optimization plumbing

### task_id: FLYWHEEL-001

- goal: 固定 `runMode` 与 scoring 准入
- inputs: 样例飞轮设计、反馈链设计
- changes: 在实施基线中明确 `plumbing / scoring`、三条 scoring 准入条件
- verification: `OptimizationCandidate` 只允许来自 scoring
- rollback: 恢复旧含糊口径
- blocks: SAMPLE-002
- done_definition: 飞轮能区分“跑流程”和“产可信优化信号”

### task_id: FLYWHEEL-002

- goal: 固定反馈归因模型
- inputs: 9 类根因、自动反馈与教师反馈双入口
- changes: 在实施基线与决策日志中明确 `primaryErrorType + contributingErrorTypes[] + confidence`
- verification: `feedback-record` 和负样本字段口径一致
- rollback: 恢复单一 `errorType` 口径
- blocks: FLYWHEEL-001
- done_definition: 根因不再被压扁成单点错误

## Epic GEN：答案生成主链

### task_id: GEN-001

- goal: 固定“生成主链与交付链分离”
- inputs: 当前 `answer.md -> PDF/review` 真相、飞轮输入源抽象
- changes: 在 PRD、终态蓝图、实施基线与决策日志中写明两条主链边界
- verification: 所有文档都不再把生成主链藏在 `deliver` 里
- rollback: 恢复旧含混叙述
- blocks: DOC-001
- done_definition: 生成主链成为独立 slice，而不是隐含能力

### task_id: GEN-002

- goal: 固定 P1 飞轮先行、生成主链后接
- inputs: 飞轮优先级决策
- changes: 在 roadmap、implementation plan、decision log 中写明生成主链接入时点
- verification: P1 顺序一致
- rollback: 恢复旧排序
- blocks: GEN-001, FLYWHEEL-001
- done_definition: 飞轮不会因生成主链未就绪而被阻塞

## Epic VISION：视觉双轨与 evidence

### task_id: VISION-001

- goal: 固定视觉对象与 Track A / Track B 口径
- inputs: 视觉专项设计、现有 figure schema
- changes: 重写 `visual-first-answering-architecture.md`
- verification: 聚合层与既有 schema 的关系清楚
- rollback: 恢复旧文档
- blocks: DOC-001
- done_definition: 视觉专项不再只有原则，没有对象模型

### task_id: VISION-002

- goal: 固定 Word / 图片 / PDF 输入边界
- inputs: 输入适配讨论结论
- changes: 在实施基线、roadmap、专项文档中写明 P1 Word degraded-supported、P2 原生解析
- verification: 所有文档对 Word 的 P1 边界一致
- rollback: 恢复旧乐观口径
- blocks: VISION-001
- done_definition: P1 不因 Word 原生解析而膨胀

### task_id: VISION-003

- goal: 落地视觉证据编译器 schema 契约
- inputs: 视觉专项设计、现有 `problem-figure-asset`、`figure-understanding-result`、review/trust 状态语义
- changes: 新增 `normalized-page / visual-region / problem-evidence-bundle / track-result / decision-record` schema，并纳入 `validate:assets`
- verification: 聚焦 contract test 通过，`validate:assets` 校验 schema 元数据通过
- rollback: 删除新增 schema，恢复 `validate-assets.mjs` 与对应 contract test
- blocks: VISION-001
- done_definition: 每个视觉小问都能用 schema 表达 `questionRef -> figureRef -> cropRef -> evidenceRef`、三轨候选、风险分类和 fail-closed 决策

### task_id: VISION-004

- goal: 建立高风险看图错误难例库
- inputs: 仪表读数、坐标图、函数图、几何图、表格统计、电路/实验装置、多图多问与低质量图像样例
- changes: 在各 subject-pack eval 中增加高风险误放行、正确标疑、图号绑定、OCR/原图冲突和 review 回放样例
- verification: 每个 subject-pack 单独报告高风险误放行率、正确标疑召回率和图号/小问绑定准确率
- rollback: 移除新增 eval 样例并恢复 dataset
- blocks: VISION-003
- done_definition: 指标不再只报总正确率，而能看到高风险视觉误放行

## Epic WORKSTATION：自动解题工作站终局

### task_id: WORKSTATION-001

- goal: 落地自动解题工作站终局计划
- inputs: 当前 `answer.md -> PDF/review` 交付链、视觉证据编译器契约、样例飞轮设计
- changes: 新增 `auto-solving-workstation-final-plan.md`，明确 `原题 -> 证据 -> 候选答案 -> 风险决策 -> review -> 可信交付`
- verification: contract test 确认 strategy README、终局计划和运行时边界存在
- rollback: 删除终局计划文件并恢复 strategy README
- blocks: VISION-003
- done_definition: 自动解题工作站不再只是会话结论，而是 strategy 真值面的一等入口

## Epic RENDERER：Typst 主渲染迁移

### task_id: RENDERER-001

- goal: 落地 Typst 主渲染目标和迁移边界
- inputs: 当前 Playwright / Chromium 渲染链、Typst 官方导出/PDF 能力、D-016
- changes: 新增 `typst-primary-renderer-plan.md` 与 `docs/adr/0006-typst-primary-renderer-target.md`
- verification: contract test 确认 ADR、迁移计划、`parity gate` 与 `rollback` 边界存在
- rollback: 恢复 D-016 候选口径，删除 ADR 0006 和迁移计划
- blocks: WORKSTATION-001
- done_definition: Typst 被记录为终局主渲染目标，但当前运行时仍明确保持 Chromium

### task_id: RENDERER-002

- goal: 固定 renderer contract 和迁移评测入口
- inputs: delivery manifest、review 页图、snapshot、现有 Chromium renderer
- changes: 新增 `renderer-contract.schema.json` 与 `eval/renderer-contract/`
- verification: `validate:assets` 校验 renderer contract fixture，contract test 确认 current/target renderer 边界
- rollback: 删除 renderer contract schema、fixture，并恢复 `validate-assets.mjs`
- blocks: RENDERER-001
- done_definition: Chromium 与 Typst 后续都必须通过同一 renderer contract，而不是各自返回 PDF 路径

## Epic REVIEW：lifecycle / queues / WPF review

### task_id: REVIEW-001

- goal: 固定 `delivery-manifest` 兼容迁移
- inputs: 现有 `status` 语义与 diagnostics 读取方式
- changes: 在实施基线中定义 `review.lifecycle`、`review.feedbackRefs[]`、`review.visualDecisionRef`
- verification: 兼容迁移与三态语义清楚
- rollback: 恢复旧口径
- blocks: DOC-001
- done_definition: review 状态机不再和 `status` 五布尔混淆

### task_id: REVIEW-002

- goal: 固定三类人工队列
- inputs: 自动反馈、优化审批、真值存疑三类场景
- changes: 在 PRD、实施基线、implementation plan 中写明三类队列
- verification: `needs_human_label / high_risk_approval / truth_needs_review` 定义一致
- rollback: 恢复旧双队列口径
- blocks: REVIEW-001
- done_definition: 真值问题不会被误推进优化队列

## Epic EVAL：分桶指标与 gate

### task_id: EVAL-001

- goal: 固定 `candidateSourceType` 分桶评测口径
- inputs: 样例飞轮与灰度放行要求
- changes: 在实施基线、roadmap、backlog 中明确三桶分桶和阈值
- verification: 文档不再只报总量指标
- rollback: 恢复旧总量口径
- blocks: SAMPLE-002, FLYWHEEL-001
- done_definition: 分桶放行成为正式门槛

### task_id: EVAL-002

- goal: 固定共同安全网口径
- inputs: 现有 `check-toolchain` 顺序
- changes: 在实施基线与 roadmap 中明确完整 gate，而不是单独 golden
- verification: gate 顺序与职责边界一致
- rollback: 恢复旧“单前置”口径
- blocks: REVIEW-001
- done_definition: schema、assembly、eval、smoke 共同受同一安全网约束
