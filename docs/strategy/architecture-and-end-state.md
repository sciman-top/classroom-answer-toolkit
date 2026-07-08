# Architecture And End State

## 1. 项目到底是什么

Classroom Answer Toolkit 不是单份提示词仓，也不是单学科脚本集合。

它的真实定位是：

- Windows-first 的本地工作站
- 以 `subject-pack` 承载学科能力
- 以 `snapshot` 承载运行时真相
- 以 `compiled spec` 承载人类规范真相
- 以 feedback / review / visual evidence 承载持续改进闭环
- 以视觉证据编译器把页图、局部 crop、OCR、layout、图元和风险决策统一成可回放证据链
- 以 Typst 作为终局主渲染目标，并在迁移期保留 Playwright / Chromium 作为当前运行时和回滚后端

## 2. 最佳终态蓝图

最佳终态是一个面向 K12 试卷参考答案交付的本地工作站产品，核心能力包括：

- 规则资产编译与版本治理
- 多 `subject-pack` 并行演进
- 本地渲染与交付
- 样例飞轮与反馈闭环
- 视觉证据、双轨比对和人工复核门禁
- 三轨视觉决策：VLM 直看、OCR/layout 结构化求解、规则校验器 fail-closed
- Typst 主渲染与 Chromium fallback 的 renderer contract

终态主线不是“生成一份 Markdown”，而是“从输入材料到可信交付”的完整链路。

## 3. 终态分层

### 桌面层

WPF + Generic Host + MVVM，负责：

- 本地入口
- orchestration
- diagnostics
- review 队列
- 交付状态

### 平台核心层

负责跨学科 contract：

- rules
- profiles
- snapshot
- delivery manifest
- workspace diagnostics
- 样例与反馈协议

### 学科包层

按 `subject-pack` 承载：

- 学段学科规则
- eval 样例
- compiled spec
- profile override

### 工具实现层

负责：

- 渲染
- OCR
- spec 汇编
- review 导出
- 视觉证据
- 实验性受控插图

## 4. 最佳终态下的主承诺

### 第一阶段主承诺

- 本地优先
- 可验证交付
- 视觉高风险可降级、可复核
- 规范变化可治理
- 反馈与样例可回放

### 第二阶段增强

以下能力属于增强，不作为当前主承诺：

- 自动作图答案图
- 全自动高风险视觉可信放行
- prompt prose 自动优化
- 多 VLM ensemble
- 未通过 parity gate 的 Typst 运行时替换

Typst 是终局主渲染目标，但不能替代视觉证据编译器，也不能在缺少分页、数学排版、证据定位和 review 回写对比评测前替换当前 Playwright / Chromium 主链。

## 5. 终态原则

1. 平台核心不承载学科知识口径。
2. 运行时真相是 `snapshot`，不是大规格 Markdown。
3. 对外可转发真相是 `compiled spec`。
4. 视觉风险必须可比对、可复核、可回放。
5. 默认主交付链不承诺 AI 自动基于题图生成答案图；若需要插图，只支持用户提供或人工复核后的受控图块插入。
6. 渲染后端必须遵守 renderer contract；Typst 升主前，Chromium 必须作为可验证 fallback 保留。
