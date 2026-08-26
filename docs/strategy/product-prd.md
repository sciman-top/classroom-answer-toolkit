# Product PRD

## Problem statement

教师需要把一份试卷快速转换成内容完整、公式正确、适合课堂展示和打印的参考答案。AI 可以生成候选，但真实 2024/2025 回归已经证明：整卷盲答和题目级高清视觉审计仍可能在滑轮、仪表、刻度与多小问覆盖上出错，因此产品必须把候选生成、视觉审计、权威参考复核、排版交付和教师验收分开表达。

## Goals

- 从任意明确路径读取 Source Exam，不要求迁移或入库。
- 生成并保留 Blind Candidate Markdown。
- 默认执行只依据原卷的 Visual Audit，并保留审计输入与摘要。
- 可选读取权威参考答案，执行 Reference Review，输出完整校正 Markdown 和可审计差异。
- 校验题号覆盖、答案格式、LaTeX、单位与排版规则。
- 生成 Markdown、PDF、review 页图、交付专属 snapshot、Delivery Manifest 1.1 和 Workflow Run Receipt。
- 明确报告 candidate、visual-audited、reference-reviewed、rendered 与 teacher-accepted 边界。

## Non-goals

- 不建设题库、知识图谱、标签库、试卷归档系统或通用视觉诊断平台。
- 不要求模型输出 `ProblemEvidenceBundle`、`TrackResult`、`DecisionRecord` 或其他内部证据对象。
- 不为 synthetic fixture 维护优化飞轮、审批队列或复杂信任聚合对象。
- 不把 provider HTTP 200、Visual Audit 完成、validator 通过或 PDF 渲染成功解释为答案正确。
- 不把 Reference-reviewed Delivery 自动解释为 Teacher Accepted。
- 不让 WPF 复制 Node 工具链业务逻辑；WPF 只提供本地文件入口、状态展示和产物打开能力。

## User-visible workflow

1. 教师选择 Source Exam PDF，并可选选择权威参考答案 PDF。
2. 系统把原卷渲染为有序页面图。
3. 系统使用当前 Subject Pack 生成 Blind Candidate。
4. 系统默认生成题目级高清重叠视窗并执行 Visual Audit；证据不足时保留候选并标示未决，不得用占位文本覆盖完整答案。
5. 如提供权威参考答案，系统执行 Reference Review，保留 Blind Candidate，并生成完整校正 Markdown 和差异报告。
6. 系统运行 validator、renderer、review 和 manifest 验证。
7. 系统持久化各 AI 阶段 summary 和整次 workflow receipt；失败阶段与保留诊断目录必须可定位，跳过阶段不得伪装为完成。
8. 教师查看或打印 Reference-reviewed Delivery；未进行参考复核时，交付必须明确需要人工复核。

## Acceptance criteria

- 初中物理运行规范使用当前已声明版本，运行摘要可证明 prompt 路径、版本和 SHA-256。
- 生成结果是完整 Markdown 正文，不含代码围栏、内部 JSON、证据对象或过程说明。
- renderer 在中文路径上稳定生成 Markdown、PDF、review 和 manifest。
- 固定 eval 覆盖选择题行、公式、仪表读数、图号绑定、必要推导和多图排版。
- 有参考答案时，差异可追踪到题号；未决差异不得静默放行。
- Visual Audit 必须记录 requested/provider detail、输入图数量和 hash，但这些字段不构成语义验收。
- 新生成的 Delivery Manifest 必须把实际输入 Markdown、最终 PDF、交付 snapshot 和同目录 `<PDF基名>.review/` 包内文件集合绑定到 SHA-256；任一文件缺失或篡改必须 fail closed，`.pdf-review/` 调试缓存不得成为归档依赖。
- workflow receipt 必须绑定 Source Exam、可选 Reference PDF、prompt、各阶段 summary/产物和阶段终态；参考差异必须以实际送入 Reference Review 的候选为基线。
- WPF publish smoke 必须在开发仓之外运行并绑定 commit、EXE 与 publish tree；当前 repository-coupled 形态不得产出或宣称自包含 MSIX。
- Teacher Accepted 只能来自教师对指定交付物的实际验收，不由 repo gate 或 manifest 自动推导。

## Current evidence boundary

- 2025 广州中考：Blind Candidate 存在实质错误；Reference Review 后完成正确排版交付；三档复跑交付已于 2026-08-26 完成首次教师验收（accepted，锚点见 docs/change-evidence/20260826-teacher-acceptance-2025-guangzhou.md）。
- 2024 广州中考：题目级 4x 左右重叠视窗和 findings/merge 已接入；Q16-Q18 无参考答案回归仍失败；Reference Review 后交付正确。
- 2015-2017 源卷已入库并有修复链，但尚未形成与 2024/2025 同级的 checked-in 回归基线（M5 进行中）。
- 2026 两份冻结 PDF（源卷与解析版）处于"待授权输入"状态，不是 baseline。
- 当前主要瓶颈是真实题目/部件定位、结构化读数和真实错题基准，不是继续扩写 100 KB 级提示词。

## Decisions 2026-08-25

- **WPF 定位为 developer/operator companion，冻结 runtime bundle 投资。** 当前真实用户是熟悉仓库与本机工具链的开发者/维护者；冻结期间仅接受安全、兼容性、进程生命周期、诊断与合同修复，暂缓教师工作流 UI、复杂界面与 runtime packaging。runtime bundle 重立项须同时满足：明确非开发者目标用户与场景、明确运行模式（在线/离线 provider）、provider 稳定性与预算授权、运行时清单/版本/签名/升级/回滚方案、至少一次代表性非开发者试用与教师验收、并证明相对仓库伴随模式确实降低部署成本而非转移安装负担。M4 兼任产品化决策门；只有该门通过，后续里程碑才实施 runtime bundle。
- **2026 回归基线暂不建立。** 在来源/使用权确认、是否纳入长期回归的方向决策、首次真实运行授权（约 6 次 AI 请求）、质量档与失败重试策略、blind/visual/reference/delivery 证据保留策略全部齐备前，两份 PDF 只能标记为待授权输入，不得称为 baseline，也不得把文件入库解释为回归链完成。
- **Teacher Acceptance 保持产品未闭合项，不由工程门禁代替。** 两份既有基线均 `teacherAccepted: false`；在真实验收记录存在前，交付最高状态只能是 reference-reviewed 或相应机器验证状态。最小真实验收协议：指定教师与试卷；记录查看版本及 manifest/hash；记录接受、拒绝或修改意见；结果写回对应 workflow receipt 或独立 acceptance record；只有记录存在且绑定产物哈希才可进入 teacher-accepted。
- **M4/VISION-101 维持 blocked。** authority、provider 稳定性与预算任一缺失即保持 blocked；代码准备度、mock 测试与本地门禁不能替代缺失的外部授权或运行预算。

## Success measures

- 参考复核后的未决差异数可追踪且不被静默丢弃。
- 2024/2025 固定错题分别报告 Blind Candidate、Visual Audit 和 Reference Review 结果。
- Focused/Core/Full 验证能按影响范围提供可解释反馈，不要求每次局部修改运行三科全量 PDF eval。
