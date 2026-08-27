# 本机交付产物目录

`artifacts/` 是本机和 CI 的可重建输出目录，不是源码或长期证据仓库。

当前目录只应保留以下结构：

```text
artifacts/
  README.md
  release/
    ClassroomToolkit-<version>-win-x64.zip
    ClassroomToolkit-<version>-source.zip
    update-manifest.json
    _manifest/spdx_2.2/manifest.spdx.json
```

其中 `release/` 的文件是当前待发布或已验证的 release 候选；它们不会提交到 Git，正式公开下载以 GitHub Release 资产为准。`publish/`、`diagnostics/`、`review-queue-observation/` 和 `tools/` 都是临时构建、审计或工具缓存，不应长期留在本目录。

使用以下命令按版本清理旧产物：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/clean-artifacts.ps1 `
  -KeepVersion 1.0.1
```

该命令只删除可重建的目录和不匹配指定版本的 release 压缩包；未知文件会保留并报告，不会被静默删除。
