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

provider 失败时按 primary、fallback 顺序切换；HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。
