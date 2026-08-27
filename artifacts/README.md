# 本机交付产物目录

`artifacts/` 是本机和 CI 的可重建输出目录，不是源码或长期证据仓库。

当前目录只应保留以下结构：

```text
artifacts/
  README.md
  deliveries/
    <version>/
      ClassroomToolkit-<version>-win-x64.zip
      ClassroomToolkit-<version>-source.zip
      update-manifest.json
      _manifest/spdx_2.2/manifest.spdx.json
  history/
    <kind>/<date-or-id>/
  work/
    <kind>/
```

`deliveries/<version>/` 只放一个版本的待发布或已验证 release 候选；`history/` 只放明确保留的历史证据或归档；`work/` 放可随时删除的构建、审计和工具中间物。三者禁止在同一层混放。除本说明外，这些内容都不会提交到 Git；正式公开下载以 GitHub Release 资产为准。

使用以下命令按版本清理旧产物：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/clean-artifacts.ps1 `
  -KeepVersion 1.0.1
```

该命令删除 `work/` 下可重建目录和 `deliveries/` 下不匹配指定版本的目录；未知顶层目录会保留并报告，不会被静默删除。
