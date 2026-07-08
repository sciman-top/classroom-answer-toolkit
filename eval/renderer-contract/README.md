# Renderer Contract Eval

本目录记录 Chromium 到 Typst 主渲染迁移的契约级评测入口。

当前状态是 `planned`，用于锁住终局目标和迁移边界：

- 当前运行时仍是 `playwright_chromium`。
- 目标主渲染是 `typst`。
- Typst 未通过 parity gate 前不得替换默认 deliver 链。
- Chromium 必须保留为 fallback 和对照后端。
