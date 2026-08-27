# 版本交付物目录

本目录只按版本分层：`<version>/` 下放对应版本的 app/source ZIP、`update-manifest.json` 和 SBOM。不要把历史版本、诊断输出或构建缓存直接放在本层；旧版本应移入 `artifacts/history/` 或由清理脚本删除。

当前候选目录：`1.0.1/`。其中的二进制文件和 SBOM 被 Git 忽略，正式公开下载以 GitHub Release 资产为准。
