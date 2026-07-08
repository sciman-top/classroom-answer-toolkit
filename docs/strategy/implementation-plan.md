# Implementation Plan

## 目标

把最终基线按可执行 slice 拆成工程实施计划，使实现者能沿着 `P0 -> P1 -> P2 -> P3` 顺序推进，而不重新解释需求边界。

## P0：文档与契约真值面收口

### 输入

- `docs/strategy/` 真值文档
- `prompts/specs/README.md`
- 现有 `prompts/shared/schemas/`
- 现有 `scripts/check-toolchain.ps1`

### 输出

- 新增与更新后的文档真值面
- 新增 schema 清单与命名约束
- `check-toolchain` 的新增校验要求说明

### 涉及文件面

- `docs/strategy/`
- `prompts/specs/README.md`
- `prompts/shared/schemas/`
- `scripts/check-toolchain.ps1`

### 完成定义

- `docs/strategy/` 成为唯一规划与实施入口
- `sample-package / sample-index / negative-candidate` 的字段形状被固定
- 运行时与文档对 `status`、`questionId`、`runMode`、`candidateSourceType` 的口径一致

### 验证方式

- 文档链接和术语一致性检查
- `validate:assets` / `check-toolchain` 设计更新通过

### 禁止扩张点

- 不在 P0 实现生成主链
- 不在 P0 做视觉双轨运行时
- 不在 P0 修改业务逻辑以外的产品承诺

## P1：飞轮先行

### 输入

- P0 后的 schema 与文档真值面
- `样例交付/` 中现有可复用样例
- 负样本候选

### 输出

- `SampleRunRecord`
- `FeedbackParseResult`
- `OptimizationCandidate`
- `DecisionRecord`
- `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord` schema 契约
- `renderer-contract` schema 契约与 Typst 主渲染迁移计划
- 第一版自动验收飞轮

### 涉及文件面

- `样例交付/`
- `artifacts/runs/`
- `feedback/`
- WPF review / feedback 入口

### 完成定义

- 能跑通至少一个 `plumbing` 轮和一个 `scoring` 轮
- 候选答案与真值分离明确
- 三类人工队列可区分
- Word 在 P1 明确只作为 `degraded-supported`
- 高风险视觉题即使双轨一致，只要证据链缺失也保持 `trusted=false`
- 当前 renderer truth 和 Typst target renderer 不再混写

### 验证方式

- 样例回放
- 分层判错验证
- 负样本判错召回验证

### 禁止扩张点

- 不把 `reference_truth` 当 `candidate`
- 不让 P1 因 Word 原生解析或图片高级预处理而膨胀
- 不允许优化信号绕过 `runMode` 与数据边界

## P1 后段：答案生成主链接入

### 输入

- 已经可运行的飞轮骨架
- 现有 `answer.md -> PDF/review` 交付链

### 输出

- `AnswerGenerationRequest`
- `AnswerGenerationResult`
- `generated` 类型候选接入飞轮

### 涉及文件面

- 生成主链接口
- 输入归一化链
- 飞轮 candidate source 接口

### 完成定义

- `generated` 候选能被飞轮读取、比对、记账和分桶统计
- 与现有 `AnswerDeliveryRequest` 明确分离

### 验证方式

- 生成候选进入 scoring
- `candidateSourceType=generated` 的分桶结果可被单独查看

### 禁止扩张点

- 不在这一阶段把生成主链与交付主链揉成一条黑盒链

## P2：双轨视觉与原生输入

### 输入

- P1 飞轮与 feedback 主链
- Track A 运行结果

### 输出

- Track B
- Track C validator
- 视觉证据编译运行时
- 双轨比对器
- 图片副链与 Word 原生解析

### 涉及文件面

- `tools/visual/`
- `tools/ocr/`
- evidence / review 文档与运行产物

### 完成定义

- 高风险图题可以被 evidence 化、分流、复核和回写
- `generated` 桶进入正式放行矩阵

### 验证方式

- 双轨一致/不一致样例
- 双轨一致但证据缺失样例
- VLM 错但 OCR/layout 对、OCR 错但 VLM 对、两者都错但规则校验拦截样例
- review 回写
- 分桶灰度验证

### 禁止扩张点

- 不提前承诺“视觉题全自动可信放行”

## P3：研究项

### 输入

- P2 完整链路
- 稳定的错例资产和统计口径

### 输出

- Prompt prose 优化研究
- 多 VLM ensemble 研究
- Typst adapter、parity runner 与 rollback smoke 研究
- 其他增强能力评估

### 完成定义

- 研究项不再只是想法，而有明确的验证数据和退出条件

### 验证方式

- A/B 评测
- 回放对比
- 误放行率与回滚率追踪

### 禁止扩张点

- 不让研究项倒逼主链提前承诺
