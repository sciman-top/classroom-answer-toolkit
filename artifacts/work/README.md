# 可重建工作产物目录

本目录只用于可随时删除的中间物，并按 `<kind>/` 分层，例如 `publish/`、`msix/`、`tools/` 和 `diagnostics/`。发布脚本、smoke、MSIX 探针和 SBOM 工具缓存都应写入这里，不得写入 `deliveries/` 或 `history/`。

`scripts/clean-artifacts.ps1` 会删除整个 `work/`。因此本 README 只是目录契约锚点，脚本运行后 `work/` 可以暂时为空或由下一次任务重新创建。
