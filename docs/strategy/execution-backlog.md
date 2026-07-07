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
