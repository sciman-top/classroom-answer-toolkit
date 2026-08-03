# QQ Heavy Visual Chain Transfer Plan

## 1. 结论

`qq-codex-bot` 的重链路方案值得吸收，但只移植阶段化视觉解题链路，不移植 `NapCatQQ + AstrBot` 运行架构。

本仓 canonical contract 继续保持：

- `ProblemEvidenceBundle`
- `TrackResult`
- `DecisionRecord`

QQ 方案中的四个概念作为阶段产物接入现有 contract：

- `VisualInputBundle`
- `GroundingSnapshot`
- `SolutionSnapshot`
- `ConsistencyReport`

这样能把“读图事实”和“解题推理”拆开，又不会把已经落盘的视觉证据编译器重新命名或推翻。

## 2. 可移植映射

| QQ 重链路概念 | 本仓落点 | 作用 |
| --- | --- | --- |
| `VisualInputBundle` | `NormalizedPage + VisualRegion + crop/OCR/layout refs` 的请求安全视图 | 控制输入图片、局部 crop、OCR/layout 片段和出网边界 |
| `GroundingSnapshot` | `TrackResult` 前置阶段产物 | 只记录可见文字、公式、已知量、待求量、图形关系和不确定项 |
| `SolutionSnapshot` | `TrackResult` 候选答案阶段产物 | 逐小问给出候选答案、使用的 knowns/relations、单位检查和 unsupported claims |
| `ConsistencyReport` | Track C / validator 阶段产物 | 检查 grounding 与 solution 是否脱钩、是否存在不安全捷径和阻断项 |

新增 schema 已落在 `prompts/shared/schemas/`，并通过 `stageArtifactRefs` 从 `TrackResult` 可选引用。`DecisionRecord` 只接收最终决策原因，不直接替代这些阶段产物。

## 3. 验收分层

QQ 的 `repo-supported / gateway-verified / live-accepted` 在本仓泛化为：

- `repo_supported`：schema、脚本、测试和 fixture 已支持。
- `gateway_verified`：AI gateway 能返回 schema-valid `TrackResult` 或阶段产物。
- `workstation_accepted`：完整 `evidence -> track -> decision -> review/manifest` 本地工作站闭环通过。

任何只达到 `repo_supported` 或 `gateway_verified` 的视觉链路，都不能宣称主答题流程已可信，也不能把高风险图题放行为 `trusted=true`。

## 4. 运行约束

- 高风险图题默认 `conservativeClarify=true`、`enableHeavyImageSolve=true`。
- `visualDetailMode=original` 表示本仓内部最高保真意图；provider 不支持 `original` 时，adapter 必须同时记录 `requestedVisualDetailMode` 和 `providerVisualDetailMode`。
- OCR/RapidOCR/PaddleOCR 只作为证据辅助和 Track B 来源，不能单独放行视觉题。
- `unsafe_shortcut_fail` 是一等失败原因：模型直接给答案但缺题干、图形关系、已知量、待求量或不确定项 grounding 时，即使候选答案碰巧正确，也必须 `trusted=false`。
- Structured output 是边界校验，不是可信充分条件；schema-valid 结果仍必须经过 `DecisionRecord` 和 review 生命周期。

## 5. 已落盘资产

- 阶段 schema：`visual-input-bundle.schema.json`、`grounding-snapshot.schema.json`、`solution-snapshot.schema.json`、`consistency-report.schema.json`。
- 兼容字段：`TrackResult.stageArtifactRefs`、`requestedVisualDetailMode`、`providerVisualDetailMode`。
- 决策原因：`unsafe_shortcut_fail`、`grounding_insufficient`、`acceptance_tier_unverified`、`strict_schema_downgraded`。
- 回归样例：`eval/visual-evidence/cases/unsafe-shortcut-grounding-missing.*`。
- 运行时：`tools/visual-evidence/decision-record.mjs` 自动识别不安全捷径和 grounding 不足；`tools/ai-gateway/vision-request.mjs` 记录 detail 请求意图与 provider 实际模式。

## 6. 不移植内容

- 不移植 QQ 群、NapCat、AstrBot、OneBot 或 live QQ 回环语义。
- 不把 QQ 的 trace 字段改成本仓 canonical 字段名。
- 不把离线 OCR 作为线上自动 fallback。
- 不改变“Typst 是终局主渲染目标，但 Chromium 仍是当前运行时”的边界。

## 7. 参考依据

- [OpenAI Images and vision](https://platform.openai.com/docs/guides/images-vision)：视觉模型在小字、旋转、图表样式、空间定位和准确性上有明确限制。
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)：结构化输出适合约束返回形状，但不能替代证据可信判断。
- [OpenAI Evals](https://platform.openai.com/docs/guides/evals)：高风险能力需要代表性数据集、criteria 和 ground truth。
- [Anthropic Vision](https://docs.anthropic.com/en/docs/build-with-claude/vision)：清晰图像、裁剪、缩放和人工核验边界是视觉任务的重要工程条件。
