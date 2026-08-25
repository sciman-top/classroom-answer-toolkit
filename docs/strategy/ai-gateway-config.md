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
  --provider all `
  --quality-profile sol-xhigh
```

质量 profile 是网关唯一的模型选择接口，固定为四档：`sol-xhigh`（`gpt-5.6-sol / xhigh`）、`sol-medium`（`gpt-5.6-sol / medium`）、`terra-xhigh`（`gpt-5.6-terra / xhigh`）、`terra-high`（`gpt-5.6-terra / high`）。默认 `auto` 为 `sol-xhigh`，所以 blind、无参考语义、视觉审计合并和参考复核不会因传输失败自动降低质量。工作流以 `-BlindQualityProfile`、`-SemanticQualityProfile`、`-VisualQualityProfile` 和 `-ReferenceQualityProfile` 分别传入阶段选择；改变 profile 必须是显式操作。

每个匹配 profile 的 provider 最多请求两次；仅同一精确 profile 的重复 provider 才可继续尝试。超时、502、429、空输出或截断均不能触发跨 profile 降级，全部同档尝试失败则 fail closed。`sol-medium` 仅适合显式草稿或成本受控试验；`terra-xhigh` 与 `terra-high` 在通过固定真实试题的阶段对比前，只能作为显式选择的独立/试验档，HTTP 成功不能证明质量等价。每次 attempt 必须记录实际 model、reasoning effort、attempt number、耗时和请求字节数。

`--timeout-ms` 是每次请求的应用层 AbortController 总上限，默认 600 秒。gateway 显式把 Undici `headersTimeout` 和 `bodyTimeout` 设为该值加 5 秒，使应用层计时器成为权威截止线，避免默认约 300 秒的响应头上限提前截断长推理。连接建立仍使用 Undici 的短超时。启用工作流 `-UseGatewayProxy` 时使用 `EnvHttpProxyAgent`，保持 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 语义。

`--provider primary|fallback|all` 只过滤同一质量 profile 内的尝试范围：`primary` 只请求主角色，`fallback` 只请求 fallback 角色，`all` 按 provider role 顺序使用该 profile 的所有角色。页数、题型和风险信号不再隐式改变模型。成功回执的 `routing` 记录 mode、quality profile、quality-degraded（当前严格策略恒为 false）、实际 `orderedRoles`、`selectedRole` 和 target，不记录密钥。

`--summary-out` 与 Markdown 都使用同目录临时文件原子替换；summary 记录 prompt/input/output SHA-256、实际 provider/model/reasoning、routing 和脱敏 attempts。summary 路径不得覆盖 prompt、候选、输入图或 Markdown 输出。

质量 profile 不是多数投票或独立正确性复核。固定高档或 HTTP 成功均不能证明答案正确；真实效果仍需同阶段可比样本或教师验收证明。

fallback 档位可只覆盖 model/reasoning，并继承 primary 的 endpoint、key、kind 与 surface。既有本机配置若还保留旧连接字段，可设置对应的 `CLASSROOM_TOOLKIT_AI_FALLBACK_n_INHERIT_PRIMARY=true` 显式忽略这些字段。HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、reasoning effort、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。

升级既有 `.env` 时只同步四组 `TEXT_MODEL`、`VISION_MODEL` 和 `REASONING_EFFORT` 到 `.env.example` 的 profile 顺序；不得复制、打印或提交 API key。旧的 `sol/high` fallback 不再匹配任一 quality profile，显式请求 `terra-xhigh` 前必须先确认本机 `.env` 已提供该精确 model/effort 组合。
