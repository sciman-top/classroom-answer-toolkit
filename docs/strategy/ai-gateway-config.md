# AI Gateway Config

## 1. Positioning

AI 网关配置是本仓的可选云兜底能力，不是默认运行时承诺。

当前主链仍是本地优先的 `answer.md -> PDF/review` 交付链。视觉解题终局方向是视觉证据编译器：先形成 `NormalizedPage / VisualRegion / ProblemEvidenceBundle / TrackResult / DecisionRecord`，再进入候选答案、风险决策和 review。

因此，多模态网关只能作为显式开启的 Track A / 云兜底输入，不能绕过 fail-closed 决策，也不能把整页图直接升级为可信答案。

## A. Config Surfaces

- 真实密钥只允许存在于本地 `.env` 或等价私有环境变量。
- `.env`、`.env.*` 必须被 Git 忽略；`.env.example` 是唯一可提交模板。
- 模板使用 `CLASSROOM_TOOLKIT_*` 前缀作为本仓正式配置契约。
- `TEXT_PROVIDER_*` 与 `IMAGE_PROVIDER_*` 只作为迁移兼容输入读取，不作为新文档或新 UI 的首选命名。
- `tools/ai-gateway/validate-config.mjs` 是当前配置校验入口。
- `tools/ai-gateway/text-request.mjs` 是当前文本请求级主备自动切换入口。
- `tools/ai-gateway/vision-request.mjs` 是当前显式视觉请求级主备自动切换入口；输出必须落到 `TrackResult`，不能直接写入可信答案或 WPF 主流程。
- 视觉请求必须记录 `requestedVisualDetailMode` 与 `providerVisualDetailMode`；例如本仓内部 `original` 代表最高保真意图，但 OpenAI-compatible provider 只接受 `high` 时，trace 必须同时保留两者。

## B. Lanes

### B.1 Text And Vision Understanding

`CLASSROOM_TOOLKIT_AI_PRIMARY_*` 和 `CLASSROOM_TOOLKIT_AI_FALLBACK_1_*` 表示 OpenAI-compatible 的文本与视觉理解网关。

必须记录：

- `KIND`
- `BASE_URL`
- `API_KEY`
- `TEXT_MODEL`
- `VISION_MODEL`
- `TEXT_SURFACE`
- `VISION_SURFACE`

`BASE_URL` 必须是 OpenAI-compatible 根路径并包含 `/v1`。外部网关必须使用 `https`；只有本机开发端点允许 `http://localhost`。

### B.2 Image Generation

`CLASSROOM_TOOLKIT_IMAGE_PRIMARY_*` 和 `CLASSROOM_TOOLKIT_IMAGE_FALLBACK_1_*` 表示图像生成 lane。

图像生成与视觉理解分开治理。`gpt-image-*` 这类图像生成模型不能被当作看图理解模型；`gpt-5.*` 这类多模态模型也不能自动等价为图像生成模型。是否可用以真实探针和 provider 文档为准。

## C. Cloud Egress

默认值必须是：

```dotenv
CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false
```

只有显式设置为 `true`，并且调用命令同时传入 `--allow-cloud-egress`，才允许 live probe 或后续云端视觉调用。

真实卷面、学生信息、教研材料优先按 `restricted` 处理。高风险视觉题若使用云兜底，必须记录 provider、model、surface、输入 crop 引用、输出摘要、风险理由和 review 状态。

## D. Verification

模板校验：

```powershell
npm --prefix tools/ai-gateway run validate:config -- --config-env-file .env.example --allow-missing-secrets
```

本地真实配置校验，不发网络请求：

```powershell
npm --prefix tools/ai-gateway run validate:config
```

live 文本探针只允许使用合成短文本，不允许上传真实试卷或学生资料：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run probe:text -- --allow-cloud-egress
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

live 探针通过只证明 provider 的文本入口可达，不证明视觉证据编译器、图像理解、图像生成或主答案链已验收。

请求级文本主备切换：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt "Return exactly OK."
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

failover 验收可以强制模拟 primary 可重试故障：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt "Return exactly OK." --force-primary-failure
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

自动切换只处理可重试故障：网络错误、超时、`408 / 409 / 425 / 429 / 5xx`。`400 / 401 / 403`、模型不存在、schema/config 错误和权限错误必须 fail-closed，不能盲目切备后掩盖配置问题。

显式视觉请求级主备切换只允许使用合成或脱敏图片。返回内容必须通过本仓 `track-result.schema.json` 校验：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --provider primary
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --provider fallback
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

视觉 failover 验收可以强制模拟 primary 可重试故障：

```powershell
$env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED = "true"
npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image --force-primary-failure
Remove-Item Env:\CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED
```

视觉 live 探针通过只证明 provider 的显式图片理解入口可达，且返回可以被本仓解析为 `TrackResult`；不等于 workflow integrated 或 live accepted。它也不证明 `ProblemEvidenceBundle -> TrackResult -> DecisionRecord -> review/trust` 的完整证据链已经进入主答题流程。

视觉能力验收统一分三层：

- `repo_supported`：schema、脚本、测试和 fixture 已支持。
- `gateway_verified`：AI gateway 能返回 schema-valid `TrackResult` 或阶段产物。
- `workstation_accepted`：完整 `evidence -> track -> decision -> review/manifest` 本地工作站闭环通过。

未达到 `workstation_accepted` 的高风险视觉链路，不能写成主答题流程可信，也不能把网关输出直接标记为 `trusted=true`。

## E. Rollback

- 删除 `CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true` 或恢复为 `false`，立即关闭 live probe 和后续云端调用入口。
- 若 provider 配置异常，先运行本地静态校验，再分别排查 base URL、model、surface、API key 和 provider 兼容头。
- 若视觉题结果异常，不得只归因于 `.env`；必须分流到输入 transport、prompt inflation、grounding、solution timeout、review gate 与本地 fallback。
