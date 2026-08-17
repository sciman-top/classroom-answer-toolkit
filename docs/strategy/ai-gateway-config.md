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
  --summary-out <stage.summary.json> `
  --provider all
```

盲答解题固定使用 `gpt-5.6-sol / xhigh`，不降级到 `sol/medium` 或任一 `terra` 档；没有匹配 provider 或请求失败时 fail closed。其他阶段按配置中的显式顺序 `primary -> fallback_1 -> fallback_2 -> fallback_3` 尝试，首个 HTTP/协议成功的结果返回。

`--provider primary|fallback|all` 只过滤尝试范围：`primary` 只请求主档，`fallback` 只请求 fallback 档，`all` 使用完整顺序。页数、题型和风险信号不再自动改变模型，避免维护没有真实比较证据的动态评分框架。成功回执的 `routing` 只记录 mode、实际 `orderedRoles`、`selectedRole` 和 target，不记录密钥。

`--summary-out` 与 Markdown 都使用同目录临时文件原子替换；summary 记录 prompt/input/output SHA-256、实际 provider/model/reasoning、routing 和脱敏 attempts。summary 路径不得覆盖 prompt、候选、输入图或 Markdown 输出。

模型顺序只是可用性 fallback，不是多数投票或独立正确性复核。固定高档或 HTTP 成功均不能证明答案正确；真实效果仍需同阶段可比样本或教师验收证明。

fallback 档位可只覆盖 model/reasoning，并继承 primary 的 endpoint、key、kind 与 surface。既有本机配置若还保留旧连接字段，可设置对应的 `CLASSROOM_TOOLKIT_AI_FALLBACK_n_INHERIT_PRIMARY=true` 显式忽略这些字段。HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、reasoning effort、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。
