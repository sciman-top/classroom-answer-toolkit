# Decision Log

## D-001 规范真值区

- 决定：人类规范统一落在 `prompts/specs/`
- 原因：把规范真值从根目录散文中抽离，便于自动汇编与校验

## D-002 4 层规范结构

- 决定：平台总则 + K12通用 + 图文定量题通用 + 物理通用 + 学段特异
- 原因：既覆盖全项目，又避免把物理特异硬塞进过宽的通用层

## D-003 完整版保留层级

- 决定：完整版也是分层结构，自包含但不揉平
- 原因：便于精确同步、转发与溯源

## D-004 视觉优先

- 决定：看图错误视为跨学科最大误差源，采用双轨并行与高风险复核
- 原因：文本/LaTeX 化后 AI 通常可答对，视觉抽取才是主要障碍

## D-005 多学段物理

- 决定：初中物理与高中物理用独立 subject-pack，不继续塞进同一包
- 原因：知识边界和规则差异大，但平台 contract 应保持稳定

## D-006 自动作图答案图降级

- 决定：不再把“AI 自动基于题图生成作图题答案图”作为主需求，只保留受控插图插入底座
- 原因：真正高风险点在视觉理解与学科判断，错误一旦被画进图里，误导性比普通文字答案更强

## D-007 生成主链与交付链分离

- 决定：`原题 -> answer.md` 与 `answer.md -> PDF/review` 视为两条独立主链
- 原因：仓内当前成熟链只有交付链，生成主链是新增工程，不应藏在既有 deliver 工具里

## D-008 P1 飞轮先行，生成主链后接

- 决定：P1 先跑通样例飞轮与反馈链，生成主链作为后段可替换输入源接入
- 原因：飞轮是当前最重要的验收载体，而生成主链独立工程量更大

## D-009 样例真值面 schema 化

- 决定：为 `sample-package`、`sample-index`、`negative-candidate`、`sample-run-record` 建立明确契约
- 原因：样例配对、候选来源和回放统计不能长期靠命名约定与口头理解

## D-010 candidateSourceType 分桶放行

- 决定：按 `candidateSourceType` 分桶统计和放行，不允许只报总分
- 原因：`perturbed_negative` 的好成绩不能掩盖 `historical_candidate` 或 `generated` 的真实表现

## D-011 Word P1 degraded-supported

- 决定：P1 的 Word 只作为 `degraded-supported` 输入与真值来源；P2 才引入原生 `docx -> NormalizedPage`
- 原因：当前仓内没有稳定的 `docx/OpenXml/OMML` 解析实现，不能让 P1 范围失控

## D-012 feedback 归因模型升级

- 决定：反馈归因采用 `primaryErrorType + contributingErrorTypes[] + confidence`
- 原因：真实失败常是复合归因，单一 `errorType` 容易导致优化器过拟合

## D-013 三类人工队列分离

- 决定：人工入口拆分为 `needs_human_label`、`high_risk_approval`、`truth_needs_review`
- 原因：反馈低置信、优化审批和真值存疑是三种不同问题，混在同一队列会误导处理流程

## D-014 外置参考仓分层收口

- 决定：活跃外置参考仓只保留 `MVVM-Samples`、`Wpf.Extensions.Hosting`、`RapidOCR`；`marp-cli` 降为次级参考；`Text-Grab` 退出活跃清单；`Typst` 与 `OCRmyPDF` 只保留候选身份
- 原因：当前主链仍是 `WPF + Generic Host + Playwright/Chromium + RapidOCR`，其余仓要么只提供模式参考，要么属于第二阶段增强，不应继续伪装成当前主设计驱动

## D-015 视觉证据编译器优先

- 决定：高风险视觉题先编译为 `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`，再进入 AI 解题或 review；不允许从整页图直接跳到 `trusted=true`
- 原因：OpenAI vision 限制和文档 layout/OCR 最佳实践都说明，小字、旋转、图表样式、空间定位和结构抽取需要证据分层处理；核心目标是降低“看错还自信输出”的误放行率

## D-016 Typst 保持第二渲染候选

- 决定：当前主渲染链继续保持 Playwright / Chromium PDF review；Typst 只作为第二 PDF 后端候选，需通过分页、数学排版、证据定位、review 回写和维护成本对比后才可升级
- 原因：视觉降错的主瓶颈是证据抽取、绑定和复核闭环，不是渲染引擎本身；提前改主渲染会扩大风险面

## D-017 Typst 主渲染终局目标

- 决定：Typst 从“第二 PDF 后端候选”升级为终局主渲染目标；当前运行时仍保持 Playwright / Chromium，直到 Typst adapter、renderer contract、parity gate 和 rollback smoke 全部通过
- 原因：自动解题工作站终局需要更稳定的文档排版、PDF metadata、PDF 标准、可访问性策略和长期归档能力；Typst 官方导出与 PDF 能力更适合作为目标后端
- 边界：D-017 调整 D-016 的终局目标，但不改变当前默认 renderer，也不允许跳过 Chromium fallback
