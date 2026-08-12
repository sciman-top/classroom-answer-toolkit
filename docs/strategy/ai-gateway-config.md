# AI Gateway Config

AI gateway 只承担原卷答案生成和参考答案复核。默认禁止 live 出网，必须同时满足：

- 命令包含 `--allow-cloud-egress`；
- `CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true`；
- `.env` 中存在可用 provider 配置。

配置模板为 `.env.example`，真实密钥只保存在本机 `.env`。

主入口：

```powershell
npm --prefix tools/ai-gateway run generate:answer -- --allow-cloud-egress `
  --images-dir <page-images> `
  --output <answer.md> `
  --provider all
```

provider 发生可重试失败时按 `primary -> fallback_1 -> fallback_2 -> ...` 数字顺序切换；fallback 档位可只覆盖 model/reasoning，并继承 primary 的 endpoint、key、kind 与 surface。既有本机配置若还保留旧连接字段，可设置对应的 `CLASSROOM_TOOLKIT_AI_FALLBACK_n_INHERIT_PRIMARY=true` 显式忽略这些字段。HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、reasoning effort、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。
