# 本机交付产物目录

`artifacts/` 是本机和 CI 的可重建输出目录，不是源码或长期证据仓库。

当前目录只应保留以下结构：

```text
artifacts/
  README.md
  deliveries/
    README.md
    <version>/
      installer/
        stable/
          ClassroomToolkit-<version>-setup.exe
          install-manifest.json
        preview/
          ClassroomToolkit-<version>-win-x64.zip
          install-release.ps1
          update-manifest.json
      source/
        ClassroomToolkit-<version>-source.zip
      private-transfer/
        ClassroomToolkit-<version>-private-dev.zip
        transfer-manifest.json
      _release-metadata/
        sbom/spdx_2.2/manifest.spdx.json
  history/
    README.md
    <kind>/<date-or-id>/
  work/
    README.md
    <kind>/
```

`deliveries/<version>/` 只放一个版本的交付物；同一版本的安装版、源码版和按需私用迁移版分别位于子目录，发布清单/SBOM/provenance 位于 `_release-metadata/`。`installer/stable/` 是普通用户安装版的合同位置，但在签名、可写 runtime bundle 和代表性非开发者验收全部满足前不得创建或发布。`history/` 只放明确保留的历史证据或归档；`work/` 放可随时删除的构建、审计和工具中间物。三者禁止在同一层混放。除本说明外，这些内容都不会提交到 Git；正式公开下载以 GitHub Release 资产为准。

三个分类目录的 README 是 Git 中的固定锚点；即使目录暂时为空，路径也不会消失。大体积交付包、历史输出和工作缓存仍按 `.gitignore` 忽略。

使用以下命令按版本清理旧产物：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/clean-artifacts.ps1 `
  -KeepVersion 1.0.1
```

该命令删除 `work/` 下可重建目录和 `deliveries/` 下不匹配指定版本的目录；未知顶层目录会保留并报告，不会被静默删除。
