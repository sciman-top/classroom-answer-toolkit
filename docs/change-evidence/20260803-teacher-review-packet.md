# 2026-08-03 教师复核包：2024/2025 广州中考物理

## 复核状态

- `repo_supported`: true
- `workflow_integrated`: true
- `reference_reviewed`: true
- `teacher_accepted`: `pending`（未由 AI 代签）
- `packet_kind`: read-only teacher review packet
- `owner`: 待指定教师/学科负责人
- `expires_at`: 2026-09-30（若交付物或当前 spec 发生变化，需重新生成本包）

本包只绑定现有本地交付物、hash 和复核范围，不复制试卷页面、参考答案正文或用户原卷内容。教师需要在本机打开正式交付目录中的 Markdown/PDF，并使用对应的官方参考答案进行逐题判断。

## 重要兼容边界

两个正式交付 manifest 都记录历史 `snapshot.version=v8.14`，而当前仓库生产 spec 已升级到初中物理 `v8.15`。因此：

- 下表交付物是历史 Reference Review 结果，不是当前 v8.15 重新生成的候选；
- 本包不自动重渲染、不覆盖正式交付、不把旧 snapshot 结果投影为当前版本结果；
- 教师可验收这些明确绑定的历史交付物；如果要验收 v8.15，必须另行显式运行工作流并生成新的 hash-bound baseline；
- `trusted=false`、`visualReviewPassed=null` 和 `teacher_accepted=pending` 必须保持原值，直到教师提交决定。

## 交付物索引

### 2024 广州中考

- 复核题目：Q5、Q16、Q17、Q18。
- 最终 Reference Review Markdown：`正式交付/2024广州中考-GPT56Sol-medium-修复后实跑/2024广州中考参考答案.md`
  - SHA-256：`959f88b63d531360ee1b12c7281d496026f3e3b16903d092790e28d5f182fcea`
- PDF：`正式交付/2024广州中考-GPT56Sol-medium-修复后实跑/2024广州中考参考答案.pdf`
  - SHA-256：`ae9ca298a39e1e3728b4af716b1b6c8499611b8278805cb0ba748b5e24ebdd4f`
  - 页面数：3；文本层可提取字符数：1430
- Delivery manifest：`正式交付/2024广州中考-GPT56Sol-medium-修复后实跑/2024广州中考参考答案.delivery-manifest.json`
  - SHA-256：`e2923ade174edfde0fc7c8ffbe958208871e67cb35e938874f346fc08f7c0cd8`
  - `lifecycle.state=ready_for_review`
  - `toolchainPassed=true`、`deliveryComplete=true`、`reviewArtifactReady=true`
  - `visualReviewPassed=null`、`trusted=false`
- 自动差异报告：`正式交付/2024广州中考-GPT56Sol-medium-修复后实跑/2024广州中考答案自动复核文本差异报告.md`
  - SHA-256：`41a0ede33b0fc4531a4ede932e8afdc55df4d43fb5903e408cee4feee75f69fd`
- 现有阶段结果：Blind Q5 pass/Q16-Q18 fail；Visual Audit Q5 pass/Q16-Q18 fail；Reference Review 4/4 pass。

### 2025 广州中考

- 复核题目：Q8、Q11、Q12、Q17、Q18。
- 最终 Reference Review Markdown：`正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.md`
  - SHA-256：`78275489329062c3b4662d94e29e71bffce545055ec5fa88ad94abdb5338e251`
- PDF：`正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.pdf`
  - SHA-256：`c3cbf510bc2455ca5af8abd278cc97f9586a8ba490a2b46900656e9ba39851ff`
  - 页面数：3；文本层可提取字符数：1203
- Delivery manifest：`正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考参考答案.delivery-manifest.json`
  - SHA-256：`1d554e2e15fec8b4919a604adabea0a40ea50154ca81d98b4b2392ef81650ea5`
  - `lifecycle.state=ready_for_review`
  - `toolchainPassed=true`、`deliveryComplete=true`、`reviewArtifactReady=true`
  - `visualReviewPassed=null`、`trusted=false`
- 自动差异报告：`正式交付/2025广州中考-GPT56Sol-medium-修复后实跑/2025广州中考答案自动复核文本差异报告.md`
  - SHA-256：`180f5152617b54dc0c93a0afca160b98354249fcc9857de5bc1507b03015ce11`
- 现有阶段结果：Blind Q8/Q11/Q12/Q17/Q18 全部 fail；Visual Audit `not_run`；Reference Review 5/5 pass。

## 权威来源绑定

权威 PDF 不进入仓库，只使用已登记的 repository-relative path 和 hash：

| 年份 | 原卷 | 参考答案 | 基准 metadata |
| --- | --- | --- | --- |
| 2024 | `广州物理中考试卷/2024广州中考.pdf`；SHA-256 `f6a3a77585343e30722ef5e09cda58795fa752e2d86c74d0dda3c89e159311ef` | `广州物理中考试卷/2024广州中考（解析版）.pdf`；SHA-256 `5b588bd2ed97be333da83a1f50031fe7f3adf66c8532506a481c97ed09adda95` | `eval/real-paper/baselines/guangzhou-physics-2024.json` |
| 2025 | `广州物理中考试卷/2025广州中考.pdf`；SHA-256 `26c8aabc95cd2ffa67ed2ea873f13c9f2cb15d8e576ca2e4d4281f00f63e0fbe` | `广州物理中考试卷/2025广州中考（答案）.pdf`；SHA-256 `214bf640b640e4a0260380779942eb39cdaada8d86be39ef1befae36ce77b91d` | `eval/real-paper/baselines/guangzhou-physics-2025.json` |

## 教师复核步骤

1. 先核对本包中的 Markdown、PDF、manifest SHA-256；任何 hash 不一致都停止复核并报告 drift。
2. 打开对应年份的官方参考答案 PDF、最终 Reference Review Markdown 和最终 PDF；不要以 Blind Candidate 或 Visual Audit 失败候选作最终交付判断。
3. 对每个指定题目逐题检查：
   - 选择题选项或最终数值是否正确；
   - 每个小问是否覆盖，题号/小题号是否绑定正确；
   - 公式、单位、方向、数量级和必要推导是否足够课堂使用；
   - 图、仪表、刻度、端子、绳段或钩码读数是否与原题一致；
   - Markdown 与 PDF 是否清晰、无截断、无错页、无不可读公式；
   - 是否需要教师改写后才可发给学生。
4. 在下表每行填写 `accept / accept_with_correction / reject`，并记录最小证据：题号、页码、现象、修正建议。
5. 只有所有目标题都完成复核，且负责人明确提交姓名、时间和决定后，才可将 `teacher_accepted` 从 `pending` 更新为 `true` 或 `false`。

## 决定表（待教师填写）

| 年份 | 题号 | 语义正确 | 图/读数正确 | 排版可用 | 决定 | 证据/修正备注 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2024 | 5 | ☐ | ☐ | ☐ | pending | |
| 2024 | 16 | ☐ | ☐ | ☐ | pending | |
| 2024 | 17 | ☐ | ☐ | ☐ | pending | |
| 2024 | 18 | ☐ | ☐ | ☐ | pending | |
| 2025 | 8 | ☐ | ☐ | ☐ | pending | |
| 2025 | 11 | ☐ | ☐ | ☐ | pending | |
| 2025 | 12 | ☐ | ☐ | ☐ | pending | |
| 2025 | 17 | ☐ | ☐ | ☐ | pending | |
| 2025 | 18 | ☐ | ☐ | ☐ | pending | |

## 机器可读决定字段

教师提交决定时应至少提供：

```text
reviewer:
reviewedAt:
artifactHashesVerified: true|false
decision: accepted|accepted_with_correction|rejected
teacherAccepted: true|false
correctionRefs:
questionDecisions:
  - year: 2024|2025
    question: <number>
    semantic: pass|fail|needs_correction
    visual: pass|fail|not_applicable
    layout: pass|fail|needs_correction
    note: <short evidence>
```

## 验证与门禁口径

本文件是纯文档/证据 checklist，不改变代码、schema、snapshot、PDF 或用户资产，因此本切片按 `gate_na` 处理：

- `reason`: no product code or generated contract changed; teacher decision is an external human action;
- `alternative_verification`: file existence/hash check、`npm --prefix eval/real-paper run validate`、pypdf read-only page/text extraction、manifest field inspection;
- `evidence_link`: this file plus `eval/real-paper/baselines/*.json`;
- `expires_at`: 2026-09-30 or first artifact/spec drift;
- `recovery_condition`: rerun packet generation after any artifact hash or current spec version change;
- fixed build/test/contract/full gate remains the required gate for any later code/spec/renderer change.

## 禁止的自动结论

- 不得把 `referenceReview pass` 写成 `teacherAccepted=true`；
- 不得把 `deliveryComplete=true` 写成答案语义正确；
- 不得把 `trusted=false` 或 `visualReviewPassed=null` 改成正值；
- 不得在没有教师身份、时间和逐题记录时生成接受结论；
- 不得修改 `正式交付/**`、`tmp/pdfs/**`、原卷、参考答案或 `.env` 来“补齐”复核证据。
