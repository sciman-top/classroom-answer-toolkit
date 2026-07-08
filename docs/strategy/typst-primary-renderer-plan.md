# Typst Primary Renderer Plan

## 1. 决策口径

终局目标采用 **Typst 主渲染**。

这是一条目标架构和迁移计划，不表示当前运行时已经切换。当前运行时仍保持 Playwright / Chromium，直到 Typst adapter、模板、manifest、review 定位和 parity gate 全部通过。

## 2. 为什么是 Typst 主渲染

Typst 更适合终局 PDF 主后端的原因：

- 文档排版模型更接近答案 PDF 的目标形态，而不是浏览器打印副产物。
- 官方文档支持导出 PDF、PNG、SVG、HTML。
- 官方 PDF 文档支持 PDF/UA 与 PDF/A 等标准能力。
- `document` metadata、语义元素、PDF 标准和可访问性能力更适合长期归档与可审阅交付。

同时必须保留现实边界：

- 当前 Chromium 链已经跑通 deliver、review、eval 和 smoke。
- Typst 还没有 repo 内 adapter、模板、schema 产物和 parity 数据。
- 所以 Typst 是终局主渲染目标，不是当前已上线主渲染。

## 3. renderer contract

所有渲染后端必须满足 `renderer-contract.schema.json`：

- `rendererId`
- `engine`
- `inputFormat`
- `outputFormats`
- `artifactContract`
- `reviewContract`
- `acceptanceGates`
- `rollback`

Chromium 与 Typst 都必须走同一个 contract。后续不能让工具脚本只靠约定返回 PDF 路径。

## 4. parity gate

Typst 进入主渲染前，必须与 Chromium 做固定样例对比。

### 必过项

- 数学公式真实渲染。
- 分页稳定。
- 题号、答案区、公式块、表格和图块定位稳定。
- review 页图可追踪到 PDF 页。
- delivery manifest 能记录 renderer、版本、模板和输出路径。
- PDF metadata 可写入。
- 可访问性与 PDF 标准能力有明确策略。
- `check-toolchain` 全链为绿。

### 必测样例

- 长公式。
- 多小问。
- 表格。
- 图文混排。
- 选择题紧凑布局。
- 高风险视觉题 review 标记。
- 受控插图回归样例。

## 5. rollback

Typst 升主后仍必须保留 Chromium 回滚后端。

回滚触发条件：

- Typst adapter 崩溃。
- PDF 生成失败。
- manifest 缺失关键字段。
- review 页图无法生成或定位漂移。
- parity gate 出现阻断级差异。

回滚策略：

- `renderer.engine=playwright_chromium` 可恢复当前交付链。
- 失败 manifest 记录 Typst 错误和 Chromium fallback 结果。
- 不允许因 Typst 失败而丢失原始 answer.md、snapshot 或 review 证据。

## 6. 分期

### R0：契约

- 新增 renderer contract schema。
- 新增 renderer-contract eval fixture。
- docs / ADR / backlog 落盘。

### R1：Typst adapter 原型

- 输入：validated answer markdown 或中间 AST。
- 输出：Typst source、PDF、manifest fragment。
- 不进入默认 deliver。

### R2：parity runner

- 同一 answer fixture 同时跑 Chromium 与 Typst。
- 比较 PDF 页数、关键文本、公式渲染、review 图和 manifest。

### R3：灰度

- subject-pack opt-in。
- `renderer.engine=typst` 只在显式配置下启用。
- 失败自动落回 Chromium。

### R4：升主

- 默认 renderer 变为 Typst。
- Chromium 保留为 fallback 和回归对照。
- README、check-toolchain、WPF 诊断、delivery manifest 全部显示当前 renderer。

## 7. 当前状态

- Current runtime: Playwright / Chromium。
- Target primary renderer: Typst。
- Migration status: planned。
- parity gate: not started。
- rollback backend: Playwright / Chromium。
