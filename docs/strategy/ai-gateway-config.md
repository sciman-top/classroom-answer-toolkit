# AI Gateway Config

AI gateway 只承担原卷答案生成和参考答案复核。默认禁止 live 出网，必须同时满足：

- 命令包含 `--allow-cloud-egress`；
- `CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true`；
- `.env` 中存在可用 provider 配置。

配置模板为 `.env.example`；当前本机 `.env` 和 `.env.cockpit` 使用 `http://localhost:45335/v1` 的 Cockpit API Service，真实 bearer token 只保存在本机配置，不提交到 Git。AI gateway 始终配置 5 个执行槽位；执行槽位不是 5 个 endpoint，也不是 5 个模型。单个 Node 进程内使用 FIFO 队列，多个 CLI 进程通过 runtime directory 中的原子 lease 共用同一组五槽位；跨进程调度以保持槽位可用为目标，不承诺全局 FIFO。

主入口：

```powershell
npm --prefix tools/ai-gateway run generate:answer -- --allow-cloud-egress `
  --images-dir <page-images> `
  --output <answer.md> `
  --summary-out <stage.summary.json> `
  --provider all `
  --quality-profile auto
```

质量 profile 是网关唯一的模型选择接口，固定为三套、每套三档：Sol 为 `sol-xhigh`（`gpt-5.6-sol / xhigh`）、`sol-medium`（`gpt-5.6-sol / medium`）、`sol-low`（`gpt-5.6-sol / low`）；Terra 为 `terra-xhigh`、`terra-high`、`terra-medium`；Luna 为 `luna-xhigh`、`luna-high`、`luna-medium`。默认 `auto` 解析为 `sol-xhigh`。`reasoning.effort` 只调节同一模型的思考预算，不替代模型选择；具体组合仍由 profile 固定。

每套 preset 都有自己的 5 槽绑定表。选择 `Sol-only` 后，5 个槽位只可绑定 `sol-xhigh`、`sol-medium`、`sol-low`，并可重复；Terra-only 和 Luna-only 遵循同一不变量。这样槽位只表达当前 preset 内的并发队列，绝不把不同模型族混为同一预设。修改映射只需修改对应的 `CLASSROOM_TOOLKIT_AI_PRESET_<PRESET>_SLOT_<1..5>`，不需要复制 Cockpit endpoint 或 API key。

| 执行槽位 | 对应 profile | 作用 |
| --- | --- | --- |
| `1` | 当前 preset 的最高档（`*-xhigh`） | 高推理队列 A |
| `2` | 当前 preset 的最高档（`*-xhigh`） | 高推理队列 B |
| `3` | 当前 preset 的中档（Sol=`medium`；Terra/Luna=`high`） | 常规队列 A |
| `4` | 当前 preset 的中档（Sol=`medium`；Terra/Luna=`high`） | 常规队列 B |
| `5` | 当前 preset 的最低档（Sol=`low`；Terra/Luna=`medium`） | 低档队列 |

槽位映射是调度策略，不是质量排序。质量排序始终由 `Sol → Terra → Luna` 决定；路由在同一 profile 的候选 provider 失败后才进入下一个模型族，不能因为槽位空闲而跳过首选模型族。

默认连通性路由按 preset 优先级 `Sol-only → Terra-only → Luna-only`。每次请求及每个 attempt 都只会激活一套 preset：先只在当前 preset 内使用一个固定 profile 和其匹配的槽位；Sol 故障后，才在 preset seam 处探测并切换到完整 Terra-only preset，Terra 不可用才切 Luna-only。跨 preset 时按相对档位而不是 effort 字面值映射：最高=`xhigh → xhigh → xhigh`，中档=`Sol/medium → Terra/high → Luna/high`，最低=`Sol/low → Terra/medium → Luna/medium`。运行时在 `CLASSROOM_TOOLKIT_AI_RUNTIME_DIRECTORY`（未设置时为 OS 临时目录）保存活跃 preset 和冷却状态；当 Sol 冷却、Terra 健康时后续请求优先 Terra，Terra 后续故障时仍先重新探测 Sol、再探测 Luna。`CLASSROOM_TOOLKIT_AI_PRESET_COOLDOWN_MS` 默认 120000 毫秒，范围为 1000–3600000。每个候选连接最多请求两次；超时、502、429、空输出或截断才进入下一 preset。每次 attempt 必须记录实际 preset、profile、model、reasoning effort、attempt number、耗时和请求字节数。高风险审批只是工作流的额外 policy/gate，既不增加第四档，也不改变单 preset、单模型族约束。

`probe:text --provider all` 在显式 preset-slot 配置下会通过每个去重后的连接依次验证全部 9 个 profile 的 model/effort 投影，并返回各 preset 中首个匹配槽位；它是能力探测，不是答案正确性验收。`/v1/models` 只证明模型标识可见，不能替代 effort 组合的请求探测。

## Sol 恢复探测器

当 `Terra-only` 或 `Luna-only` 因 Sol 故障成为活动 preset 时，可由独立的 recovery reconciler 低频确认 Sol 是否恢复：

```powershell
npm --prefix tools/ai-gateway run reconcile:recovery -- --allow-cloud-egress
# 持续运行；适合临时的前台观察。
npm --prefix tools/ai-gateway run watch:recovery -- --allow-cloud-egress
```

将自动运行投影到当前 Windows 用户时，使用可逆的 PowerShell 7 入口；它每分钟执行一次本地状态检查，只有 deadline 到期才会实际请求 Sol：

```powershell
pwsh -NoProfile -File scripts/manage-ai-gateway-recovery-reconciler.ps1 -Mode Install -StartNow
pwsh -NoProfile -File scripts/manage-ai-gateway-recovery-reconciler.ps1 -Mode Status
pwsh -NoProfile -File scripts/manage-ai-gateway-recovery-reconciler.ps1 -Mode Uninstall
```

任务名为 `ClassroomAnswerToolkit-AiGatewayRecovery`，以 S4U 批处理登录（非交互会话，不闪控制台窗口，锁屏/未登录期间照常运行），默认持续 365 天；再次执行 `Install` 会原位更新定义。`Install`/`Uninstall` 涉及 S4U 登记类型，需要管理员权限（否则报"拒绝访问"），`Status`/`RunOnce` 不需要。它只发送低推理强度（reasoning=low、512 输出 token 上限）的最小 `Return exactly OK.` 请求（推理 token 计入输出上限，业务档位的 xhigh 会让小上限探测永远无法完成），直接调用 Cockpit API、**不占用五个业务执行槽位**。首次 probe 在 Sol 失败后的 `PRESET_COOLDOWN_MS`（默认 2 分钟）后才允许；成功后每 5 分钟复测，失败后退避至 15 分钟，并加最多 ±30 秒的抖动。必须连续 2 次精确 `OK` 才设置 `recoveryReady`；probe 不会把 `activePreset` 伪装成 Sol，下一次真实业务请求成功走 Sol 后才真正更新活动 preset。

`CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_ENABLED=true` 只允许该机制运行；仍必须同时满足 `.env` 的 `CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true` 和命令行 `--allow-cloud-egress`。所有时间和阈值可用 `RECOVERY_PROBE_INTERVAL_MS`、`RECOVERY_PROBE_FAILURE_INTERVAL_MS`、`RECOVERY_PROBE_SUCCESS_THRESHOLD`、`RECOVERY_PROBE_JITTER_MS` 与 `RECOVERY_PROBE_TIMEOUT_MS` 覆盖。没有启动 `watch:recovery` 时，系统保留按业务请求的既有回退路径，但不会产生后台恢复探测。

`--timeout-ms` 是每次 attempt 从进入槽位队列开始计算的应用层 AbortController 总上限，默认 600 秒。槽位等待耗尽时会生成带 `EXECUTION_SLOT_TIMEOUT` 语义的 retryable attempt，并继续按既定模型族链路处理，不会无限排队。gateway 显式把 Undici `headersTimeout` 和 `bodyTimeout` 设为该值加 5 秒，使应用层计时器成为权威截止线，避免默认约 300 秒的响应头上限提前截断长推理。连接建立仍使用 Undici 的短超时。启用工作流 `-UseGatewayProxy` 时使用 `EnvHttpProxyAgent`，保持 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 语义。

`--provider primary|fallback|all` 过滤 preset 内的连接角色：`primary` 只请求主角色，`fallback` 只请求 fallback 角色，`all` 按 preset 优先级和角色顺序使用候选。provider 本地拒绝（401/403/404/405/413，即该 endpoint 自身的 key/URL/payload 问题）不终止整条链，改为继续尝试下一连接或下一 preset；其余非 retryable 失败仍 fail closed。页数、题型和风险信号不改变默认 preset 优先级。成功回执的 `routing` 明确记录 `requestedPreset`、`resolvedPreset`、实际唯一的 `activePreset`、请求与实际 quality profile、实际 `orderedPresets`、`orderedRoles`、`orderedExecutionSlots`、`selectedRole`、实际 `executionSlot` 和 target，不记录密钥；实际切到另一 preset 或不同推理档时 `qualityDegraded=true`。每个 attempt 同时记录实际 preset、profile、slot、model 和 reasoning effort。

`--summary-out` 与 Markdown 都使用同目录临时文件原子替换；summary 记录 prompt/input/output SHA-256、实际 provider/model/reasoning、routing 和脱敏 attempts。summary 路径不得覆盖 prompt、候选、输入图或 Markdown 输出。

质量 profile 不是多数投票或独立正确性复核。固定高档或 HTTP 成功均不能证明答案正确；真实效果仍需同阶段可比样本或教师验收证明。

fallback 档位的连接继承合同：显式设置 `INHERIT_PRIMARY=true` 才完整继承 primary 的 endpoint、key、kind 与 surface；该标志与本地自定义连接字段（BASE_URL/API_KEY/KIND/surface）并存属配置错误。只配 `BASE_URL` 而无本档 `API_KEY` 会被直接拒绝（跨网关复用 primary key）；完全省略连接字段的旧配置暂可继续工作，但产生 `connectionSource=primary` 迁移告警，应迁移到显式标志。既有本机配置若曾依赖隐式继承，请在兼容窗口内迁移。HTTP 成功只证明请求完成，不证明答案正确。运行证据至少记录 provider role、model、reasoning effort、status、prompt SHA-256、输入页数和输出 SHA-256，严禁记录 API key。

`--config-env-file` 的相对路径解析基准因 CLI 而异：`validate:config` 与 `request:text` 按仓库根解析；`generate:answer` 的输入路径按 `INIT_CWD`/`process.cwd` 解析；`run-live-answer-workflow.ps1` 先按仓库根解析再以绝对路径传入。自动化示例应优先使用绝对路径。

升级既有 `.env` 时保留一个可复用的 `PRIMARY` 连接，并把 15 个 `CLASSROOM_TOOLKIT_AI_PRESET_<PRESET>_SLOT_<N>` 映射同步到 `.env.example`；不得为同一个 Cockpit endpoint 复制 8 份 API key。显式选择某个 profile 时，先使用所属 preset；只有该 preset 的连接不可用才切换完整备用 preset。旧的 `FALLBACK_1..8` 模型 role 配置仍可读取，作为旧式多连接兼容路径；槽位不再由旧的 `CLASSROOM_TOOLKIT_AI_PROFILE_*_SLOT` 表达。旧配置省略 `EXECUTION_SLOT` 时按 role 稳定推导，建议迁移为显式 5 槽 preset 映射。

该分层与官方 reasoning 参数语义、以及成熟网关将 retry/cooldown、部署组和跨模型 fallback 分开管理的做法一致：

- OpenAI reasoning guide: https://developers.openai.com/api/docs/guides/reasoning
- LiteLLM fallback/reliability: https://docs.litellm.ai/docs/proxy/reliability
- Portkey fallback patterns: https://portkey.ai/docs/product/ai-gateway/fallbacks
