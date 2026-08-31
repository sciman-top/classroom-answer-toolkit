# 版本交付物目录

本目录只按版本分层：`<version>/` 下按交付类型放置 `installer/stable/`、`installer/preview/`、`source/` 和按需的 `private-transfer/`；版本元数据放在 `_release-metadata/`。`installer/stable/` 可以暂存本地 unsigned candidate，但在代码签名、runtime bundle 和实机验收合同满足前不得标记或发布为 stable，也不得用 preview ZIP 代替。不要把历史版本、诊断输出或构建缓存直接放在本层；旧版本应移入 `artifacts/history/` 或由清理脚本删除。

当前候选目录：`<version>/`。其中的二进制文件、迁移包和 SBOM 被 Git 忽略，正式公开下载以 GitHub Release 资产为准。
