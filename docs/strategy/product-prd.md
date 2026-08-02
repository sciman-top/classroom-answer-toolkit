# Product PRD

## Problem statement

教师需要把一份试卷快速转换成内容完整、公式正确、适合课堂展示和打印的参考答案。AI 可以生成候选，但真实 2024/2025 回归已经证明：整卷盲答和题目级高清视觉审计仍可能在滑轮、仪表、刻度与多小问覆盖上出错，因此产品必须把候选生成、视觉审计、权威参考复核、排版交付和教师验收分开表达。

## Goals

- 从任意明确路径读取 Source Exam，不要求迁移或入库。
- 生成并保留 Blind Candidate Markdown。
- 默认执行只依据原卷的 Visual Audit，并保留审计输入与摘要。
- 可选读取权威参考答案，执行 Reference Review，输出完整校正 Markdown 和可审计差异。
- 校验题号覆盖、答案格式、LaTeX、单位与排版规则。
- 生成 Markdown、PDF、review 页图和 Delivery Manifest。
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
7. 教师查看或打印 Reference-reviewed Delivery；未进行参考复核时，交付必须明确需要人工复核。

## Acceptance criteria

- 初中物理运行规范使用当前已声明版本，运行摘要可证明 prompt 路径、版本和 SHA-256。
- 生成结果是完整 Markdown 正文，不含代码围栏、内部 JSON、证据对象或过程说明。
- renderer 在中文路径上稳定生成 Markdown、PDF、review 和 manifest。
- 固定 eval 覆盖选择题行、公式、仪表读数、图号绑定、必要推导和多图排版。
- 有参考答案时，差异可追踪到题号；未决差异不得静默放行。
- Visual Audit 必须记录 requested/provider detail、输入图数量和 hash，但这些字段不构成语义验收。
- Teacher Accepted 只能来自教师对指定交付物的实际验收，不由 repo gate 或 manifest 自动推导。

## Current evidence boundary

- 2025 广州中考：Blind Candidate 存在实质错误；Reference Review 后完成正确排版交付，教师验收仍未记录。
- 2024 广州中考：题目级 4x 左右重叠视窗和 findings/merge 已接入；Q16-Q18 无参考答案回归仍失败；Reference Review 后交付正确。
- 当前主要瓶颈是真实题目/部件定位、结构化读数和真实错题基准，不是继续扩写 100 KB 级提示词。

## Success measures

- 参考复核后的未决差异数可追踪且不被静默丢弃。
- 2024/2025 固定错题分别报告 Blind Candidate、Visual Audit 和 Reference Review 结果。
- Fast/Core/Full verifier 能按影响范围提供可解释反馈，不要求每次局部修改运行三科全量 PDF eval。
