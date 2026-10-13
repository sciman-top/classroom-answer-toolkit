# 版本交付物目录

本目录只按版本分层：`<version>/` 下按交付类型放置 `installer/stable/`、`portable/`、`source/` 和按需的 `private-transfer/`；版本元数据放在 `_release-metadata/`。`installer/stable/` 可保存默认无签名的候选包；Authenticode 为可选身份信号，正式 stable 发布仍须满足 runtime bundle、包哈希、SBOM、GitHub build provenance 和代表性非开发者实测合同。更新后的应用可从已签名安装迁移至无签名更新，并转而信任 GitHub HTTPS 清单及 SHA-256；已发布的旧版应用仍要求 Authenticode，首次迁移需手动下载安装包，之后会移除旧 publisher pin。不要把历史版本、诊断输出或构建缓存直接放在本层；旧版本应移入 `artifacts/history/` 或由清理脚本删除。

当前候选目录：`<version>/`。其中的二进制文件、迁移包和 SBOM 被 Git 忽略，正式公开下载以 GitHub Release 资产为准。
