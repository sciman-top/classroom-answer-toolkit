# Classroom Answer Toolkit 产品与架构深度审查

日期：2026-07-07

## 1. 审查范围

本次审查同时覆盖：

- 仓库当前公开目标、功能、需求、产品设计
- 当前已实现工程形态与真实能力边界
- 工程终态、技术栈、架构是否与当前目标匹配
- 对官方文档、社区成熟项目与最佳实践的对标结论

## 2. 一句话结论

本仓当前最真实的定位，不是“完整的 AI 自动解题桌面产品”，而是：

> 一个 **Windows-first、本地优先、以 subject-pack 和 snapshot 为核心的试卷参考答案交付工具链**，当前主线聚焦“初中物理答案 Markdown/PDF 交付 + 规则校验 + 渲染 + 审阅支撑 + 诊断导出”。

它的 **底层工程方向大体正确**，尤其是：

- `subject-pack + snapshot + schema + eval` 的平台化思路是对的
- Windows 本地桌面壳 + 本地工具链编排是对当前场景合理的
- Markdown/LaTeX/PDF 渲染链已经形成可跑通闭环
- 多学科扩展采用 contract-first，而不是复制提示词，是正确路线

但它 **还没有达到“最佳终态”**。当前最关键的问题不是“缺少更多功能”，而是：

1. 产品叙事仍在“平台雄心”与“当前主线能力”之间摆动
2. 文档把“视觉优先 / 双轨复核”定义成核心原则，但产品与运行时尚未把这条主线真正做实
3. 交付状态模型里已经有 `reviewArtifactReady / visualReviewPassed / trusted`，却缺少把结果推进到“人工验收通过”的闭环

## 3. 仓库真相：这个项目现在到底是什么

### 3.1 当前主产品

当前最完整、最可信的产品主线是：

- 输入试卷相关材料
- 生成或整理答案 Markdown
- 用本地规则和快照校验答案格式
- 渲染为 PDF
- 产出审阅页图
- 保留 subject-pack / snapshot / manifest / eval 证据

这条链路当前最成熟的是：

- `junior-physics-answer`

仓库已经明确：

- `senior-physics-answer` 是模板化接入位
- `math-answer` 是实验性第二学科支架
- 自动作图答案图不再是主需求，只保留受控插图底座

### 3.2 当前真实非目标

以下能力 **不应再被视为当前主交付承诺**：

- 全自动基于题图生成答案图
- 全自动完成高风险视觉题并直接放行
- 自动判定答案正确率
- 多学科生产级全覆盖
- 在线聊天机器人式澄清追问与运行时路由

### 3.3 当前已实现的核心工程骨架

当前已基本落地的工程骨架是：

1. `prompts/specs/`：人类规范真值区
2. `tools/spec-assembler/`：规范汇编
3. `prompts/<subject-pack>/`：学科包资产
4. `tools/rule-compiler/`：snapshot 编译与资产校验
5. `tools/latex-renderer/`：校验、渲染、review、deliver、eval
6. `src/ClassroomToolkit.App/`：Windows/WPF 本地入口
7. `eval/`：固定样例与视觉基线

这说明本仓已经从“长提示词仓库”走向“平台化工具链仓库”，这一步方向是正确的。

## 4. 对标结论

### 4.1 Windows 桌面壳与 Generic Host

对标官方 Microsoft 文档后，当前选择 **WPF + .NET Generic Host** 是合理的。

- Microsoft 已给出在 WPF 中接入 Generic Host 的官方做法
- Generic Host 提供 DI、配置、日志、生命周期管理
- 官方文档对新项目更推荐 `Host.CreateApplicationBuilder`

结论：

- “做 Windows-first 本地桌面工具壳”这一方向没有问题
- 但当前宿主层还停留在“能跑”的最小形态，对日志、配置、生命周期服务、后台任务和可观测性利用不足

### 4.2 Markdown -> PDF 渲染栈

当前仓库使用：

- `markdown-it`
- `KaTeX`
- `playwright-core`
- Chromium / Edge / Chrome

这条路线本身是合理的。官方 Playwright 文档明确支持 `page.pdf()`，而且社区成熟项目 `marp-cli` 也采用“Markdown + 浏览器导出 PDF”的思路。

结论：

- 现有渲染栈不是错误路线
- 对“快速本地渲染、易调试、易集成 CSS 样式”很合适
- 但如果未来把“长文档稳定分页、排版确定性、可访问性元数据、文档语义”作为硬目标，仅靠 HTML/CSS/浏览器打印可能不是最优终态

### 4.3 Typst 作为潜在替代或第二渲染后端

官方 Typst 文档显示：

- Typst 是原生文档排版系统
- 有明确的 PDF 元数据与 PDF 标准控制能力
- 近期版本进一步增强了 PDF 标记和可访问性能力

结论：

- Typst 很适合作为“高确定性排版后端”的候选
- 但当前仓库不应立即整体迁移
- 更合适的策略是：先把 Typst 当作 **第二渲染后端实验线**，只用于验证“分页稳定性、题号布局、可访问性、导出一致性”是否显著优于 Chromium 打印

### 4.4 OCR 路线

当前仓库 OCR 分两类：

- 浏览器页图 + `tesseract.js` 的辅助 OCR
- Python `RapidOCR` 的本地批量 OCR

这对“辅助审阅”是够用的，但对“扫描 PDF 的归档级处理”仍偏弱。OCRmyPDF 的官方文档强调：

- 给现有 PDF 增加 OCR 文本层
- 尽量保持原 PDF 不被破坏
- 支持 deskew 等预处理
- 适合可搜索归档 PDF 的生产处理

结论：

- 当前 OCR 路线更像“视觉辅助检查工具”
- 若未来要处理大量低质量扫描卷、并追求长期归档和可检索 PDF，建议增加 OCRmyPDF 类能力，而不是只停留在页图 OCR

### 4.5 JSON Schema / contract-first

当前仓库大量使用 Draft 2020-12 JSON Schema，这是正确方向。

优点：

- 运行时 contract 明确
- subject-pack 可校验
- diagnostics / manifest / snapshot 有统一结构

但仍有一个可改进点：

- schema 已声明 `$schema`，但缺少稳定 `$id`

这意味着：

- 当前适合仓内使用
- 若未来跨仓复用、远程引用、发布版本化 schema catalog，会增加治理成本

## 5. 最关键的改进问题

### 5.1 问题一：产品边界仍然不够“硬”

仓库现在有两套容易冲突的心智：

1. 平台雄心：跨学科、跨学段、视觉优先、作图能力、桌面终态
2. 当前主线：本地答案交付工具链，先把主链做稳

现在虽然 ADR 已经把自动作图降级，但“产品到底卖什么能力”仍然可以更明确。

建议固定为三层边界：

1. **当前主承诺**
   - 本地规则化答案交付
   - Markdown/PDF 渲染
   - review 证据与诊断导出
   - 主线学科为初中物理
2. **已接入但非生产承诺**
   - 高中物理模板包
   - 初中数学实验包
   - 受控插图
3. **未来研究方向**
   - 双轨视觉求解
   - 高风险视觉复核流水线
   - Typst 后端
   - 自动化图题理解

### 5.2 问题二：视觉优先是文档主轴，但不是产品主轴

文档里把“视觉双轨 + 高风险复核”定义为核心策略，这个判断本身是对的。

但当前真实情况更接近：

- 规范中已经有高风险规则
- eval 中已有高风险样例
- manifest 中已有 review/trust 状态字段
- 但没有真正的视觉证据对象流水线，也没有产品化 review 队列

建议把“视觉优先”分为三个阶段推进，而不是继续停留在原则口号：

1. **阶段 A：审阅就绪**
   - 先把 review 页图、源题页图、疑点定位、状态回写做完整
2. **阶段 B：风险识别**
   - 增加题型风险分类器与哨兵样例
3. **阶段 C：双轨求解**
   - 再接入真正的多模态直答 / OCR+结构化证据双轨

### 5.3 问题三：缺少“人工验收通过”闭环

状态模型已经有：

- `reviewArtifactReady`
- `visualReviewPassed`
- `trusted`

这说明设计上已经知道“工具链跑通”和“最终可放心交付”不是一回事。

但当前仓库缺的是：

- 人工复核后的状态更新入口
- 对 review 结果的持久化协议
- UI 中的验收动作
- 报告中“已复核 / 未复核 / 不可信”的清晰分层

建议新增：

- `review session` 或 `acceptance record`
- 人工勾选通过/退回
- 题目级疑点与页级批注定位
- 交付清单中的最终 acceptance 状态

## 6. 对“是否最佳”的直接判断

### 6.1 功能/需求/产品设计

不是最佳，但方向基本正确。

判断：

- 当前“功能面”不算弱，已经有规则、校验、渲染、评测、桌面壳、OCR、diagnostics
- 真正的问题不在“功能少”，而在“产品主承诺未完全冻结”
- 后续最重要的是收紧主产品，而不是继续横向加功能

### 6.2 工程终态

原先“自动作图答案图 + 全平台化桌面产品”的终态叙事已经过满。  
更现实、更优的终态应当是：

> **一个面向 K12 试卷参考答案交付的本地工作站产品**  
> 其核心能力是“规则资产编译 + 多 subject-pack + 本地渲染交付 + 审阅证据 + 人工验收闭环”。

双轨视觉能力、图题自动化、Typst 后端都应该是 **第二阶段增强能力**，而不是一开始绑成总目标。

### 6.3 技术栈

整体上“可接受且合理”，但不是最终最优。

建议判断：

- **保留**
  - WPF
  - .NET
  - Generic Host
  - JSON Schema
  - snapshot runtime
  - Playwright PDF 渲染链
- **增强**
  - Host builder 现代化
  - logging / configuration / options
  - Playwright trace/report tooling
  - OCRmyPDF 级扫描件处理
- **评估但不立即替换**
  - Typst 作为第二 PDF 后端

### 6.4 架构

底层架构比产品层更成熟。

优点：

- subject-pack 边界明确
- 规则真值与运行时快照分离合理
- 评测和视觉基线意识到位
- 桌面壳没有直接吞掉全部业务，仍保留脚本/工具链可独立运行

不足：

- 产品层尚未承载“视觉优先”主张
- review / trust 生命周期没有闭环
- 桌面壳还更像工具入口，而不是完整工作站

## 7. 推荐的下一步终态路线

### P0：先把产品边界冻结

- README、strategy、UI 文案统一成同一产品叙事
- 明确当前主承诺、实验能力、未来研究线
- 不再把自动作图或全自动视觉解题写成交付承诺

### P1：把 review / trust 做成完整状态机

- 生成 -> 待复核 -> 已复核通过 -> 退回修订
- 让 `visualReviewPassed`、`trusted` 真正可写
- 在 diagnostics 和交付清单中显式呈现

### P1：让视觉优先先落在“审阅闭环”，再落在“自动求解”

- 先补 source-review、疑点定位、页图联动
- 再补高风险题型分类
- 最后再补双轨求解

### P2：桌面壳现代化

- `Host.CreateApplicationBuilder`
- 标准化 logging / configuration / options
- 更清晰的后台任务与诊断输出

### P2：增强渲染与回归可观测性

- 引入 Playwright trace / report 工具能力
- 保留现有自定义脚本，但给失败案例更多调试证据

### P3：评估第二 PDF 后端

- 选一组固定题卷
- 对比 Chromium 打印与 Typst 的分页稳定性、数学排版、元数据、可访问性
- 以实测而非偏好决定是否双后端并存

### P3：扫描件 OCR 升级

- 在批量扫描卷场景下，引入 OCRmyPDF 类“原 PDF + OCR layer”路线
- 继续保留 RapidOCR/Tesseract 作为辅助审阅工具

## 8. 本次外部对标来源

官方文档：

- Microsoft Learn: Generic Host in WPF app
- Microsoft Learn: .NET Generic Host
- Microsoft Learn: .NET dependency injection
- Playwright docs: `page.pdf()`
- Playwright docs: Trace Viewer / best practices
- JSON Schema docs
- Typst docs
- OCRmyPDF docs

社区成熟项目：

- `marp-team/marp-cli`

## 9. 最终判断

本仓 **不是方向错误**，相反，底层工程骨架已经比很多“提示词项目”成熟得多。  
但它 **还没有收敛成一个产品上最优、边界上最硬、验收上最闭环的终态**。

最优先要做的，不是继续扩功能，而是：

1. 固化主产品边界
2. 做完整人工复核闭环
3. 让视觉优先从文档原则变成真实工作流
4. 再决定是否继续扩展 Typst / OCRmyPDF / 双轨求解等增强能力
