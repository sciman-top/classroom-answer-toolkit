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

Gateway 会按任务项编排四档模型，而不是把整份文档固定到同一档位。路由只使用工作流 mode 和当前已存在的输入规模事实：

- AI 盲答解题固定使用 `gpt-5.6-sol / xhigh`，不因页数或风险信号降档，也不降级到 `sol/medium` 或任一 `terra` 档；没有匹配 provider 时 fail closed。小规模参考复核仍首选 `sol/medium`，大规模参考复核首选 `sol/xhigh`，并保留各自任务降级链。
- 视觉审计：小规模使用 `terra/high`，中规模首选 `terra/xhigh`，大规模（原卷或审计输入达到 8 页）首选 `sol/xhigh`；相应降级链保持视觉任务优先 `terra/xhigh -> sol/xhigh -> terra/high -> sol/medium` 或 `sol/xhigh -> terra/xhigh -> sol/medium -> terra/high`。
- 视觉 findings 提取或确定性 Markdown 合并：小/中规模首选 `terra/high`，大规模 findings 首选 `terra/xhigh`；降级链优先保留结构化整理档位。

这是有限的确定性分类，不是通用评分框架：页数阈值只用于区分低、中、高复杂度，调用方不需要知道档位细节。`--provider primary|fallback|all` 仍然有效；显式 `primary` 只请求主档，显式 `fallback` 只在任务专属顺序中筛选 fallback 档，`all` 才执行完整任务链。每次成功回执的 `routing` 字段记录 `taskType`、`complexity`、`preferredRole`、实际 `orderedRoles` 与原因，不记录密钥。

页数不是语义难度的充分代理。盲答解题已经固定为 `sol/xhigh`；对其余阶段，调用方已有可审计事实时，可重复传入 `--risk-signal`：`multi_part` 只把低复杂度提升到常规档；`visual_binding`、`unit_conflict`、`validator_conflict`、`prior_regression_failure`、`reference_conflict` 会把语义复核提升到 `sol/xhigh`，视觉 findings 提取提升到 `terra/xhigh`。风险信号必须来自原卷结构、validator、既有回归或权威参考冲突，不能由模型自报或凭题型猜测；receipt 会记录信号与是否升级。

除盲答解题外，四档顺序仍是可用性 fallback，不是多数投票或独立正确性复核：首个 HTTP/协议成功的结果会返回。盲答解题的 `sol/xhigh` 请求若失败则整体失败。固定高档只能提高质量优先级，不能证明答案正确；是否“最优”仍只由 `eval/real-paper` 中绑定到明确模型档位的同阶段可比真实样本决定，样本不足时必须报告 `insufficient_comparative_evidence`。

fallback 档位可只覆盖 model/reasoning，并继承 primary 的 endpoint、key、kind 与 surface。既有本机配置若还保留旧连接字段，可设置对应的 `CLASSROOM_TOOLKIT_AI_FALLBACK_n_INHERIT_PRIMARY=true` 显式忽略这些字段。HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、reasoning effort、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。
