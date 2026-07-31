# Product PRD

## 1. 产品目标

Classroom Answer Toolkit 的目标不是做“提示词仓库”，而是做一个 Windows-first、本地优先的 K12 试卷参考答案工作站。

它要解决的核心问题是：把试卷材料、学科规范、视觉风险、交付渲染、人工复核和后续反馈收敛到同一条可验证链路里，让参考答案交付既可自动化推进，又不会在高风险图题上失控。

## 2. 目标用户

- 一线教师：需要把试卷材料转成适合课堂投屏、打印与归档的参考答案。
- 教研或助教人员：需要对答案、图题、格式和交付结果做复核、抽检和修订。
- 工程与提示词维护者：需要在规范高频变化、学科扩展和错例回流下持续维护系统。

## 3. 核心使用场景

### 场景 A：已有答案 Markdown 的本地交付

用户已经有答案 Markdown，希望快速渲染成 PDF，并附带 review 页图与交付状态。

### 场景 B：样例卷端到端验收

维护者使用样例卷、参考答案和候选答案跑自动验收飞轮，定位错因、生成反馈记录和优化候选。

### 场景 C：高风险视觉题复核

用户或维护者对图题、仪表读数、函数图、电路图等高风险题目查看视觉证据、判断是否需要人工复核或降级。

视觉复核不只看整页截图，而是查看 `questionRef -> figureRef -> cropRef -> evidenceRef` 的证据链，以及 Track A / B / C 的候选、冲突点和疑点原因。

### 场景 D：规范演化与多学科扩展

维护者在学段学科规则持续变化时，更新源规范、汇编生成物、结构化资产和评测集，并验证对既有主线无回退。

## 4. 问题定义

当前项目的底层工程骨架已经成熟，但产品层还有三个关键闭环未完全打通：

- 规范治理：高频变化仍缺少可机器化的版本治理、影响分析与兼容窗口。
- 反馈闭环：教室反馈、自动验收结果和优化候选还没有完整的结构化闭环。
- 视觉降错：视觉证据、双轨比对和高风险题复核还没有真正进入运行时工作流。

## 5. 产品范围

### 当前主承诺

- 本地优先的参考答案交付工作站。
- 以 `subject-pack + snapshot + compiled spec + eval` 为核心资产模型。
- 初中物理为当前最完整主线；高中物理为模板包；初中数学为实验支架。
- `answer.md -> PDF/review` 交付链持续可用。
- 通过样例飞轮、反馈链和视觉证据逐步把产品层做实。
- 终局目标是自动解题工作站：`原题 -> 证据 -> 候选答案 -> 风险决策 -> review -> 可信交付`。
- 终局渲染目标是 Typst 主渲染；当前运行时仍保持 Playwright / Chromium，直到 renderer parity gate 通过。

### 当前不承诺

- 高风险图题全自动且默认可信放行。
- 自动基于题图生成作图题答案图。
- Prompt prose 自动优化直接进入生产。
- 在 P1 交付 Word 原生结构化解析主链。

## 6. 非目标

- 不把项目做成云优先 SaaS 平台。
- 不在当前阶段承诺跨全部学科、全部学段一次性通吃。
- 不为了样例数量很小的阶段，提前建设复杂的自动答案剥离系统。
- 不在文档层平行维护第二套根目录总纲。

## 7. 成功指标

- 高风险题误放行率持续下降，且保留明确的 review/downgrade 出口。
- 题号/图号绑定成功率可被稳定统计。
- 反馈结构化成功率和自动回放通过率可被稳定统计。
- 指标必须按 `candidateSourceType` 分桶，不能只报总分。
- 样例飞轮可以在不依赖手工口头判断的前提下产出可信优化信号。

## 8. 验收边界

- 文档与规划真值统一落在 `docs/strategy/`。
- 规范真值统一落在 `prompts/specs/`。
- 当前成熟主链仍然是 `answer.md -> PDF/review`。
- `原题 -> answer.md` 是新增主链，应作为独立工程能力建设。
- GEN-003 只用 provider-neutral 合同和明确标记的 deterministic `synthetic_fixture` 验证生成到飞轮的仓内闭环；它不是 live 模型能力或 WPF workflow。
- VISION-010 只对 committed structure/OCR diagnostic authorities 做穷举几何测量；它不选择 OCR-region 匹配，不构成 layout semantics、FigureUnderstanding 或 Track B。
- VISION-011 只用 renderer 源码显式声明的 synthetic text/bbox 作为 generator-declared truth，诊断三份固定 fixture 的 exact-text OCR 漏检与误检；它不是人工 truth、真实 OCR benchmark 或 OCR acceptance。
- VISION-012 只用同一 generator-declared truth 诊断 VISION-008 heuristic text-region candidate 对 fully-visible label 的空间覆盖；它不识别文字、不选择 OCR-region association，也不构成 layout semantics 或 Track B acceptance。
- VISION-013 以透明标记的 `ai_agent` 对公开 synthetic crop 建立 hash-bound machine review receipt，VISION-015 将覆盖面扩为四份；`synthetic_fixture_equivalent` 只允许它替代本切片的合成样本视觉检查，`humanReviewed=false`，不得写成 `humanApproved`、真实数据验收、delivery trust 或 live acceptance。
- VISION-016 只把独立声明的 `measurement_reading` 角色投影到 VISION-011/012/014 已共同证明的唯一 truth/OCR/candidate association 上；recognized text 只来自绑定 OCR observation，不构成 layout、FigureUnderstanding、Track B、答案或 trust authority。
- VISION-017 只把一份 public synthetic question authority、ProblemEvidenceBundle 与 VISION-016 projection 绑定为 deterministic `ocr_layout_solver` TrackResult；数值只取 OCR-bound text，quantity/unit 只取题干显式 authority，候选固定 review required，不构成通用题意/单位理解、Track C、DecisionRecord acceptance、workflow integrated 或 live accepted。
- VISION-018 只对 VISION-017 的 question/bundle/projection/solver-request/Track B 五份 current bytes 执行七项 deterministic Track C consistency checks；canonical checks 全部 pass 仍固定 review required、untrusted、controls not verified，不能写成答案已批准、三轨已编排、DecisionRecord 已接受或 live accepted。
- VISION-019 实际准入并编排一组 public synthetic Track A/B/C，分别报告 A/B agreement/conflict、complete/degraded inventory、Track C 与全源 blocking findings，并只调用既有 DecisionRecord compiler；canonical DecisionRecord 仍为 review required/untrusted，不能写成真实 provider orchestration、答案批准、WPF workflow、gateway/workstation verified 或 live accepted。
- VISION-020 从 VISION-007 current source 确定性生成一份带透视、旋转和噪声的 public synthetic capture，检测最大外部凸四边形并输出 hash-bound 560x360 `NormalizedPage`；`regionRefs=[]`，只证明 page-normalization plumbing，不构成自动区域检测、真实照片质量、OCR/layout/Track/workflow 或 live acceptance。
- VISION-021 只在 VISION-020 normalized page 上自动提出两个 hash-bound `heuristicOnly` content-block candidates 与 diagnostic overlay；它不使用 `VisualRegion.regionType`，不构成 question/figure/text/axis/table 分类、region 质量指标、OCR/Track/workflow 或 live acceptance。
- VISION-022 为每个 VISION-021 proposal 生成 1x pixel-preserving 与 2x nearest local crops；2x 不代表恢复细节，不构成 semantic `VisualRegion`、OCR 改善、Track/workflow 或 live acceptance。
- VISION-023 只用独立 public synthetic declaration 把两个 VISION-021 proposals 与四份 VISION-022 crop bytes 投影为有限 `text_area / measurement_reading` 和 `scale_area / measurement_scale_baseline` VisualRegion；编译器不从像素、文件名、OCR、题干或答案推断语义，不建立 question binding、Track input、answer/trust authority、WPF workflow 或 live acceptance。
- VISION-024 只用独立 public synthetic declaration 将 `junior-instrument-scale` current structure bytes 中的一组 pointer edge pair 和五组 major-tick edge pairs 编译为有限 component semantics；不构成自动 tick/pointer 检测、量程/分度值/读数理解、FigureUnderstanding、Track、答案、trust 或 live authority。
- 高风险视觉题的新增主链必须先经过视觉证据编译器，形成 `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`，不得从整页图直接跳到可信答案。
- Typst 主渲染属于终局迁移目标；未通过 parity gate 前，不得把当前运行时描述为 Typst 已上线。
- 自动验收与优化候选只能在门禁通过、数据边界允许、真值可靠时推进。

## 9. 数据边界

- 默认本地优先，`egressPolicy.allowCloud=false`。
- `restricted` 数据默认不得出本机。
- 真实卷面、学生信息、教研材料优先按 `restricted` 处理。
- 若高风险题需要云兜底，必须显式启用、显式记录、显式可审计。

## 10. 人工参与边界

人工不是默认主链，但始终保留三类明确入口：

- `needs_human_label`：反馈解析置信不足。
- `high_risk_approval`：高风险优化候选需要审批。
- `truth_needs_review`：参考答案抽取不可靠、答案泄漏未解决或真值本身存疑。

其中视觉证据链缺失、双轨冲突、图号绑定不稳或高风险图题人工批准，统一归入 `high_risk_approval`，不新增第四类人工队列。

人工参与的目标不是替代自动化，而是在高风险处作为明确、可追溯的兜底边界。

## 11. 与其他文档的关系

- 终态蓝图：见 [architecture-and-end-state.md](./architecture-and-end-state.md)
- 权威实施规格：见 [final-implementation-baseline.md](./final-implementation-baseline.md)
- 阶段路线图：见 [implementation-roadmap.md](./implementation-roadmap.md)
- 执行清单：见 [execution-backlog.md](./execution-backlog.md)
