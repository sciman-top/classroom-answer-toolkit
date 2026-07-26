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

### task_id: VISION-005

- goal: 建立显式视觉探针与最小 fail-closed 决策编译闭环
- inputs: `tools/ai-gateway` 文本主备切换、`track-result.schema.json`、`decision-record.schema.json`、`eval/visual-evidence/`
- changes: 新增 `request:vision` 显式 synthetic 图片探针，新增 `tools/visual-evidence` 离线 `DecisionRecord` 编译器，并纳入 `check-toolchain`
- verification: `npm --prefix tools/ai-gateway run test:vision`、`npm --prefix tools/visual-evidence run test:decision`、`scripts/check-toolchain.ps1`
- rollback: 删除 `vision-request.mjs`、`tools/visual-evidence/`、对应 README/strategy 文档和 check-toolchain 接入
- blocks: VISION-003
- done_definition: 双轨一致但证据缺失的样例可由运行时代码推导为 `review_required`、`trusted=false`，且视觉 live 探针只作为 gateway verified 边界，不升级为 workflow integrated

### task_id: VISION-006

- goal: 建立交付题目覆盖证明与 delivery-level DecisionRecord 聚合合同
- inputs: `sample-package.expectedQuestionRefs`、delivery manifest、snapshot/input bytes、题目级 DecisionRecord
- changes: 新增 `DeliveryQuestionCoverage / DeliveryDecisionAggregate` schema、SHA-256 delivery binding、离线聚合编译器、合成完整覆盖 fixture 和 fail-closed 测试；纳入 `validate:assets` 与 `check-toolchain`
- verification: visual-evidence aggregate 聚焦测试、静态 fixture 确定性重编译、cross-subject contract、完整项目门禁
- rollback: 删除两个 schema、aggregate 工具/fixture/测试，回滚 DecisionRecord/ProblemEvidenceBundle 可选 binding、validator/hotspot 和 strategy/evidence 修改
- blocks: VISION-005, SAMPLE-001
- done_definition: 对 schema-valid sample-package inventory，仓内可证明 snapshot/input/manifest bytes 与逐题 DecisionRecord 的完整覆盖并生成离线 aggregate；不修改 delivery manifest，不开放 WPF 正向 trust，不宣称真实试卷 inventory 或 live acceptance 已完成

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

### task_id: REVIEW-003

- goal: 将最新交付的 review/trust 状态以只读方式投影到 WPF
- inputs: `delivery-manifest.review`、`delivery-manifest.status`、既有 WPF 答案交付入口
- changes: `AnswerDeliveryResult` 增量承载 `review.lifecycle / visualDecisionRef / visualReviewPassed / trusted`，WPF 展示 fail-closed 状态并只允许打开 JSON 决策证据
- verification: orchestrator 与 MainViewModel 聚焦测试、WPF build、headless smoke、完整项目门禁
- rollback: 回滚本任务对 Domain / Services / ViewModel / XAML / tests / strategy / evidence 的修改
- blocks: REVIEW-001, VISION-005
- done_definition: 一次交付后 WPF 可展示最新 review/trust 投影；缺失状态保持未裁定和未可信，且不宣称完整 review 队列或默认主答题流程已经接入

### task_id: REVIEW-004

- goal: 建立本地 `DecisionRecord -> delivery manifest -> WPF refresh` 受控附着闭环
- inputs: `decision-record.schema.json`、`delivery-manifest.schema.json`、REVIEW-003 最新交付状态投影
- changes: `tools/visual-evidence` 校验决策与 manifest、把直接前像刷新到 rollback backup 并原子更新决策引用和 fail-closed 状态；题目级决策禁止正向 trust 提升；.NET orchestrator 调用工具、重读 manifest 并验证后置条件；WPF 仅选择本地 JSON 并刷新状态
- verification: Node 附着合同测试、orchestrator 与 MainViewModel 聚焦测试、原生 WPF UI Automation 观察、完整项目门禁
- rollback: 回滚本任务对 visual-evidence / Domain / Application / Services / ViewModel / XAML / tests / strategy / evidence 的修改；已有 manifest 可用 `.before-visual-decision.json` 恢复
- blocks: REVIEW-003, VISION-005
- done_definition: WPF 能把已有本地题目级 `DecisionRecord` 交给仓内工具校验和附着，并从更新后的 manifest 刷新 review/trust 投影；该入口不接受 delivery aggregate，不能提升为 trusted；WPF 不生成审批、不推进 lifecycle，且不宣称完整 review 队列或默认主答题流程已经接入

### task_id: REVIEW-005

- goal: 建立 `DeliveryDecisionAggregate -> delivery manifest` 的受控附着与可重验 hash receipt
- inputs: `DeliveryDecisionAggregate`、其原始 manifest preimage、delivery manifest review/status、attachment receipt
- changes: 新增 aggregate attachment receipt schema 和本地 attach/verify 工具；附件前重算 aggregate 并要求 preimage bytes 匹配，两个 attach 共用 manifest 写锁，receipt 后替换前复核全源稳定快照，再原子替换 manifest；.NET 消费者在 source-aware verifier 正向投影接入前保持 fail-closed；不推进 lifecycle
- verification: aggregate attachment 合同测试覆盖成功、幂等、preimage/source 漂移、receipt/backup 篡改、canonical/physical 双锁、hardlink alias 串行化、dangling symlink 拒绝、部分获取/action 异常/token 替换清理、stale-lock 保留；malformed attachment 的 .NET fail-closed 回归；assets/cross-subject/full gates
- rollback: 用 `<manifest>.before-delivery-decision-aggregate.json` 恢复 preimage，并删除同名 attachment receipt；代码不自动回收 stale lock，仅在确认 owner PID 已死亡、没有 writer 活动且保存锁证据后人工清理 canonical/physical lock；回滚本任务 schema/tool/test/doc 修改
- blocks: VISION-006, REVIEW-004
- done_definition: 合成受控 aggregate 可把 trusted projection 写入 manifest，且后续 verifier 能从 manifest、receipt、backup、aggregate 及其绑定源重算稳定 hash chain；WPF/diagnostics/headless 在 source-aware verifier 正向投影接入前保持 fail-closed；不接入 WPF 正向附着、不生成审批、不推进 lifecycle、不宣称 workflow integrated 或 live acceptance

### task_id: REVIEW-006

- goal: 把既有 aggregate attachment source-aware verifier 暴露为显式、只读、强类型的 .NET orchestration 能力
- inputs: 已附着 delivery manifest 与 `verify:aggregate-attachment` JSON 输出
- changes: Domain/Application 增加验证请求、结果与强类型凭据；orchestrator 以 `node` 进程直接调用既有 verifier，严格校验输出 kind、请求 manifest 相关性、绝对 artifact paths、attachment id、SHA-256 与正向状态；进程启动、执行或结构化输出失败时不返回验证凭据
- verification: orchestrator 聚焦测试覆盖成功、进程/启动失败、取消透传、输入拒绝、非 JSON、多 JSON、重复/未知/缺失字段、路径不匹配、hash 非法和非正向状态；真实 `PowerShellProcessRunner -> node -> synthetic fixture` 集成测试；完整项目门禁
- rollback: 回滚本任务对 Domain / Application / Services / tests / strategy / evidence 的修改；本能力只读，不需要恢复 manifest 或外部数据
- blocks: REVIEW-005
- done_definition: .NET 调用方可显式重验已附着 aggregate 并取得与请求 manifest 绑定的强类型凭据；现有 `ReadDeliveryContext`、WPF、diagnostics/headless 仍保持 fail-closed，不自动执行 verifier、不正向投影 trust、不生成审批、不推进 lifecycle、不宣称 workflow integrated 或 live acceptance

### task_id: REVIEW-007

- goal: 将 source-aware aggregate attachment verifier 以显式、只读方式接入 WPF 正向状态投影
- inputs: REVIEW-006 强类型 verifier、当前 delivery manifest、receipt `manifestResultSha256`
- changes: verifier 成功后从同一次读取的 manifest bytes 重算 SHA-256，只在匹配 `manifestResultSha256` 时构造正向 `AnswerDeliveryResult`；WPF 增加手动重验命令、验证状态和 verified manifest hash，命令开始或失败时先钳制为未裁定/未可信；普通 deliver、题目级附着、diagnostics、headless 和自动读取不复用旧凭据
- verification: manifest 漂移拒绝、普通读取 fail-closed、真实 Node integration、MainViewModel 成功/失败/旧状态清理、原生 WPF UI Automation、完整项目门禁
- rollback: 回滚本任务对 Domain / Services / ViewModel / XAML / tests / strategy / evidence 的修改；本能力只读，不恢复或删除 delivery artifacts
- blocks: REVIEW-006
- done_definition: WPF 能由用户显式重验已附着 aggregate，并只投影与 verifier result hash 绑定的时间点状态；不自动验证、不提供 aggregate 附着、不生成审批、不推进 lifecycle，diagnostics/headless 仍 fail-closed，不宣称完整 workflow integrated 或 live acceptance

### task_id: REVIEW-008

- goal: 建立 `DeliveryDecisionAggregate -> delivery manifest -> source-aware reverify -> WPF projection` 受控闭环
- inputs: REVIEW-005 attach 工具、REVIEW-006 强类型 verifier、REVIEW-007 hash-bound WPF 投影
- changes: Domain/Application 增加 aggregate 附着请求与结果；orchestrator 以 `node` 直接调用既有 attach CLI，只有附着成功才立即调用 source-aware verifier；WPF 允许用户选择已有本地 aggregate，开始、失败或异常时先钳制旧 review/trust/hash，只有两阶段成功才投影正向状态
- verification: attach 失败不触发 verifier、附着后重验失败保持 fail-closed、真实 `PowerShellProcessRunner -> node attach -> node verify -> synthetic fixture` 集成测试、MainViewModel 正向/失败/旧状态清理、原生 WPF UI Automation、完整项目门禁
- rollback: 代码回滚本任务 Domain / Application / Services / ViewModel / XAML / tests / strategy / evidence 修改；对已附着 manifest，先保全当前 manifest/receipt/backup，重验 hash chain，确认当前 manifest hash 仍等于 receipt `manifestResultSha256`，并通过同一 canonical/physical 双锁原子恢复 `<manifest>.before-delivery-decision-aggregate.json` 后再处理 receipt。hash 漂移或锁归属不明时转人工 reconciliation，禁止覆盖后续合法更新；stale lock 仍只允许按 REVIEW-005 人工审计流程清理
- blocks: REVIEW-007
- done_definition: WPF 能把已有本地 aggregate 交给既有受控工具附着，并在同一显式动作中立即 source-aware 重验；正向状态绑定当前 `manifestResultSha256`。不生成 aggregate、不生成审批、不推进 lifecycle、不自动验证、不接入原题生成或云网关主流程，不宣称完整 workflow integrated 或 live acceptance

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
